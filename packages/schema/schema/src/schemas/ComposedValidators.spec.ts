import {describe, expect, it} from 'vitest';
import {IsObject} from './IsObject';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsArray} from './IsArray';
import {GGIssuesList} from "../issue/GGIssuesList";
import {testUtils} from "../utils/testUtils";
import {IsStringErrors} from "../Errors";

/**
 * Tests for composed validators - ensuring that when validator B is used both
 * standalone AND as part of validator A, both work correctly.
 *
 * This verifies there are no AOT caching issues where one validator's compiled
 * code incorrectly assumes context from another.
 */
testUtils('ComposedValidators', () => {

    describe('object B used standalone and inside object A', () => {
        // Define validator B (inner schema)
        const UserSchema = IsObject({
            name: IsString,
            age: IsNumber
        });

        // Define validator A that uses B
        const TeamSchema = IsObject({
            teamName: IsString,
            leader: UserSchema,
            members: IsArray(UserSchema)
        });

        const validUser = {name: 'John', age: 30};
        const validTeam = {
            teamName: 'Alpha',
            leader: {name: 'Jane', age: 35},
            members: [{name: 'Bob', age: 25}, {name: 'Alice', age: 28}]
        };

        describe('B (UserSchema) works standalone', () => {
            it('is() validates correctly', () => {
                expect(UserSchema.is(validUser)).toBe(true);
                expect(UserSchema.is({name: 'John'})).toBe(false);
                expect(UserSchema.is({name: 123, age: 30})).toBe(false);
                expect(UserSchema.is(null)).toBe(false);
            });

            it('parse() works correctly', () => {
                const issues = new GGIssuesList();
                const result = UserSchema._parse(validUser, issues, 'user');
                expect(issues.length).toBe(0);
                expect(result).toEqual(validUser);
            });

            it('parse() strips extra properties', () => {
                const issues = new GGIssuesList();
                const result = UserSchema._parse({...validUser, extra: 'stripped'}, issues, 'user');
                expect(issues.length).toBe(0);
                expect(result).toEqual(validUser);
                expect(Object.keys(result!)).toEqual(['name', 'age']);
            });

            it('parse() collects errors correctly', () => {
                const issues = new GGIssuesList();
                UserSchema._parse({name: 123, age: 30}, issues, 'user');
                expect(issues.length).toBeGreaterThanOrEqual(1);
                expect(issues.getIssue(0)?.code).toBe(IsStringErrors.typeError.code);
                expect(issues.getPath(0)).toBe('user.name');
            });

            it('stringify() works correctly', () => {
                const json = UserSchema.stringify(validUser);
                expect(JSON.parse(json!)).toEqual(validUser);
            });
        });

        describe('A (TeamSchema) works with B inside', () => {
            it('is() validates correctly', () => {
                expect(TeamSchema.is(validTeam)).toBe(true);
                expect(TeamSchema.is({...validTeam, leader: {name: 'Bad'}})).toBe(false);
                expect(TeamSchema.is({...validTeam, members: [{name: 'Bad'}]})).toBe(false);
            });

            it('parse() works correctly', () => {
                const issues = new GGIssuesList();
                const result = TeamSchema._parse(validTeam, issues, 'team');
                expect(issues.length).toBe(0);
                expect(result).toEqual(validTeam);
            });

            it('parse() strips extra properties at all levels', () => {
                const issues = new GGIssuesList();
                const input = {
                    teamName: 'Alpha',
                    extra: 'team-level',
                    leader: {name: 'Jane', age: 35, extra: 'leader-level'},
                    members: [{name: 'Bob', age: 25, extra: 'member-level'}]
                };
                const result = TeamSchema._parse(input, issues, 'team');
                expect(issues.length).toBe(0);
                expect(Object.keys(result!)).toEqual(['teamName', 'leader', 'members']);
                expect(Object.keys(result!.leader)).toEqual(['name', 'age']);
                expect(Object.keys(result!.members[0])).toEqual(['name', 'age']);
            });

            it('parse() reports errors from nested B correctly', () => {
                const issues = new GGIssuesList();
                TeamSchema._parse({...validTeam, leader: {name: 123, age: 35}}, issues, 'team');
                expect(issues.length).toBe(1);
                expect(issues.getPath(0)).toBe('team.leader.name');
            });

            it('stringify() works correctly', () => {
                const json = TeamSchema.stringify(validTeam);
                expect(JSON.parse(json!)).toEqual(validTeam);
            });
        });

        describe('B still works after A is compiled/used', () => {
            it('is() still validates correctly', () => {
                // First use A
                expect(TeamSchema.is(validTeam)).toBe(true);
                // Then verify B still works
                expect(UserSchema.is(validUser)).toBe(true);
                expect(UserSchema.is({name: 'John'})).toBe(false);
            });

            it('parse() still works correctly', () => {
                // First use A
                TeamSchema._parse(validTeam, new GGIssuesList(), 'team');

                // Then verify B still works
                const issues = new GGIssuesList();
                const result = UserSchema._parse(validUser, issues, 'user');
                expect(issues.length).toBe(0);
                expect(result).toEqual(validUser);
            });

            it('stringify() still works correctly', () => {
                // First use A
                TeamSchema.stringify(validTeam);

                // Then verify B still works
                const json = UserSchema.stringify(validUser);
                expect(JSON.parse(json!)).toEqual(validUser);
            });
        });
    });

    describe('deeply nested composition A -> B -> C', () => {
        // C is the innermost
        const AddressSchema = IsObject({
            street: IsString,
            city: IsString
        });

        // B uses C
        const PersonSchema = IsObject({
            name: IsString,
            address: AddressSchema
        });

        // A uses B (which uses C)
        const CompanySchema = IsObject({
            companyName: IsString,
            ceo: PersonSchema,
            employees: IsArray(PersonSchema)
        });

        const validAddress = {street: '123 Main', city: 'NYC'};
        const validPerson = {name: 'John', address: validAddress};
        const validCompany = {
            companyName: 'ACME',
            ceo: {name: 'Jane', address: {street: '456 Oak', city: 'LA'}},
            employees: [validPerson]
        };

        it('C works standalone', () => {
            expect(AddressSchema.is(validAddress)).toBe(true);
            expect(AddressSchema.is({street: '123'})).toBe(false);

            const issues = new GGIssuesList();
            const result = AddressSchema._parse({...validAddress, zip: '12345'}, issues, 'addr');
            expect(Object.keys(result!)).toEqual(['street', 'city']);
        });

        it('B works with C inside', () => {
            expect(PersonSchema.is(validPerson)).toBe(true);
            expect(PersonSchema.is({name: 'John', address: {street: '123'}})).toBe(false);

            const issues = new GGIssuesList();
            PersonSchema._parse({name: 'John', address: {street: 123, city: 'NYC'}}, issues, 'person');
            expect(issues.getPath(0)).toBe('person.address.street');
        });

        it('A works with B and C inside', () => {
            expect(CompanySchema.is(validCompany)).toBe(true);

            const issues = new GGIssuesList();
            const input = {
                companyName: 'ACME',
                extra: 'stripped',
                ceo: {name: 'Jane', extra: 'stripped', address: {street: '456', city: 'LA', extra: 'stripped'}},
                employees: [{name: 'John', extra: 'stripped', address: {street: '123', city: 'NYC', extra: 'stripped'}}]
            };
            const result = CompanySchema._parse(input, issues, 'company');
            expect(issues.length).toBe(0);

            // Verify stripping at all levels
            expect(Object.keys(result!)).toEqual(['companyName', 'ceo', 'employees']);
            expect(Object.keys(result!.ceo)).toEqual(['name', 'address']);
            expect(Object.keys(result!.ceo.address)).toEqual(['street', 'city']);
            expect(Object.keys(result!.employees[0])).toEqual(['name', 'address']);
            expect(Object.keys(result!.employees[0].address)).toEqual(['street', 'city']);
        });

        it('all three (A, B, C) work correctly after interleaved usage', () => {
            // Use in various orders
            expect(CompanySchema.is(validCompany)).toBe(true);
            expect(AddressSchema.is(validAddress)).toBe(true);
            expect(PersonSchema.is(validPerson)).toBe(true);
            expect(CompanySchema.is(validCompany)).toBe(true);
            expect(AddressSchema.is(validAddress)).toBe(true);

            // Parse in various orders
            const i1 = new GGIssuesList();
            const i2 = new GGIssuesList();
            const i3 = new GGIssuesList();

            CompanySchema._parse(validCompany, i1, 'c');
            AddressSchema._parse(validAddress, i2, 'a');
            PersonSchema._parse(validPerson, i3, 'p');

            expect(i1.length).toBe(0);
            expect(i2.length).toBe(0);
            expect(i3.length).toBe(0);
        });
    });

    describe('same schema referenced multiple times in parent', () => {
        const ItemSchema = IsObject({
            id: IsNumber,
            name: IsString
        });

        // Parent uses ItemSchema in multiple places
        const OrderSchema = IsObject({
            orderId: IsNumber,
            primaryItem: ItemSchema,
            secondaryItem: ItemSchema.orUndefined,
            allItems: IsArray(ItemSchema)
        });

        const validItem = {id: 1, name: 'Widget'};
        const validOrder = {
            orderId: 100,
            primaryItem: {id: 1, name: 'Primary'},
            secondaryItem: {id: 2, name: 'Secondary'},
            allItems: [{id: 3, name: 'Item3'}, {id: 4, name: 'Item4'}]
        };

        it('ItemSchema works standalone', () => {
            expect(ItemSchema.is(validItem)).toBe(true);
            expect(ItemSchema.is({id: 'bad', name: 'Widget'})).toBe(false);
        });

        it('OrderSchema validates all item references correctly', () => {
            expect(OrderSchema.is(validOrder)).toBe(true);

            // Invalid primary
            expect(OrderSchema.is({...validOrder, primaryItem: {id: 'bad', name: 'Primary'}})).toBe(false);

            // Invalid secondary
            expect(OrderSchema.is({...validOrder, secondaryItem: {id: 2, name: 123}})).toBe(false);

            // Invalid in array
            expect(OrderSchema.is({...validOrder, allItems: [{id: 'bad', name: 'Item'}]})).toBe(false);
        });

        it('parse reports correct paths for each item reference', () => {
            const issues1 = new GGIssuesList();
            OrderSchema._parse({...validOrder, primaryItem: {id: 'bad', name: 'Primary'}}, issues1, 'order');
            expect(issues1.getPath(0)).toBe('order.primaryItem.id');

            const issues2 = new GGIssuesList();
            OrderSchema._parse({...validOrder, secondaryItem: {id: 2, name: 123}}, issues2, 'order');
            expect(issues2.getPath(0)).toBe('order.secondaryItem.name');

            const issues3 = new GGIssuesList();
            OrderSchema._parse({...validOrder, allItems: [{id: 1, name: 'OK'}, {id: 'bad', name: 'Item'}]}, issues3, 'order');
            expect(issues3.getPath(0)).toBe('order.allItems.1.id');
        });

        it('ItemSchema still works after OrderSchema usage', () => {
            // Use OrderSchema first
            OrderSchema.is(validOrder);
            OrderSchema._parse(validOrder, new GGIssuesList(), 'order');
            OrderSchema.stringify(validOrder);

            // ItemSchema should still work correctly
            expect(ItemSchema.is(validItem)).toBe(true);
            expect(ItemSchema.is({id: 'bad', name: 'Widget'})).toBe(false);

            const issues = new GGIssuesList();
            const result = ItemSchema._parse({...validItem, extra: 'stripped'}, issues, 'item');
            expect(Object.keys(result!)).toEqual(['id', 'name']);
        });
    });

    describe('array of primitives vs array of objects', () => {
        const StringArraySchema = IsArray(IsString);
        const ObjectArraySchema = IsArray(IsObject({value: IsString}));

        const ParentSchema = IsObject({
            tags: StringArraySchema,
            items: ObjectArraySchema
        });

        it('StringArraySchema works standalone', () => {
            expect(StringArraySchema.is(['a', 'b', 'c'])).toBe(true);
            expect(StringArraySchema.is(['a', 123, 'c'])).toBe(false);
        });

        it('ObjectArraySchema works standalone', () => {
            expect(ObjectArraySchema.is([{value: 'a'}, {value: 'b'}])).toBe(true);
            expect(ObjectArraySchema.is([{value: 123}])).toBe(false);
        });

        it('ParentSchema uses both correctly', () => {
            const valid = {
                tags: ['tag1', 'tag2'],
                items: [{value: 'item1'}, {value: 'item2'}]
            };
            expect(ParentSchema.is(valid)).toBe(true);

            expect(ParentSchema.is({...valid, tags: ['tag1', 123]})).toBe(false);
            expect(ParentSchema.is({...valid, items: [{value: 123}]})).toBe(false);
        });

        it('both array schemas work after parent usage', () => {
            ParentSchema.is({tags: ['a'], items: [{value: 'b'}]});

            expect(StringArraySchema.is(['x', 'y'])).toBe(true);
            expect(ObjectArraySchema.is([{value: 'z'}])).toBe(true);
        });
    });

    describe('schema with constraints used in multiple contexts', () => {
        // Schema with constraints
        const NonEmptyStringSchema = IsString.minLength(1);
        const PositiveNumberSchema = IsNumber.min(0);

        const StandaloneUsage = IsObject({
            label: NonEmptyStringSchema,
            count: PositiveNumberSchema
        });

        const NestedUsage = IsObject({
            container: IsObject({
                innerLabel: NonEmptyStringSchema,
                innerCount: PositiveNumberSchema
            })
        });

        it('constrained schemas work in standalone object', () => {
            expect(StandaloneUsage.is({label: 'test', count: 5})).toBe(true);
            expect(StandaloneUsage.is({label: '', count: 5})).toBe(false);
            expect(StandaloneUsage.is({label: 'test', count: -1})).toBe(false);
        });

        it('constrained schemas work in nested object', () => {
            expect(NestedUsage.is({container: {innerLabel: 'test', innerCount: 5}})).toBe(true);
            expect(NestedUsage.is({container: {innerLabel: '', innerCount: 5}})).toBe(false);
            expect(NestedUsage.is({container: {innerLabel: 'test', innerCount: -1}})).toBe(false);
        });

        it('constraints enforced correctly after both usages', () => {
            // Use both
            StandaloneUsage.is({label: 'a', count: 1});
            NestedUsage.is({container: {innerLabel: 'b', innerCount: 2}});

            // Verify constraints still work
            expect(NonEmptyStringSchema.is('')).toBe(false);
            expect(NonEmptyStringSchema.is('x')).toBe(true);
            expect(PositiveNumberSchema.is(-1)).toBe(false);
            expect(PositiveNumberSchema.is(0)).toBe(true);
        });
    });
});
