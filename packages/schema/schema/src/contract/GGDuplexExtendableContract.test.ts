import {describe, expect, it} from 'vitest';
import {GGDuplexExtendableContract, getExtendableContractParent} from './GGDuplexExtendableContract';
import {SERVER_ERROR} from './ERROR';
import {IsObject} from '../schemas/IsObject';
import {IsString} from '../schemas/IsString';

describe('GGDuplexExtendableContract', () => {

    const makeBase = () => new GGDuplexExtendableContract('Chat', {
        connect: {errors: [SERVER_ERROR]},
    });

    it('extend() produces a contract carrying its own methods and the module name', () => {
        const base = makeBase();
        const messaging = base.extend('Messaging', {
            clientToServer: {send: {input: IsObject({text: IsString}), errors: [SERVER_ERROR]}},
            serverToClient: {message: {input: IsObject({text: IsString})}},
        });
        expect(messaging.name).toBe('Messaging');
        expect(Object.keys(messaging.clientToServer.methods)).toContain('send');
        expect(Object.keys(messaging.serverToClient.methods)).toContain('message');
    });

    it('shares the base connect method across children by reference', () => {
        const base = makeBase();
        const a = base.extend('A', {clientToServer: {ping: {errors: [SERVER_ERROR]}}});
        const b = base.extend('B', {clientToServer: {pong: {errors: [SERVER_ERROR]}}});
        expect(a.connect.method).toBe(b.connect.method);
    });

    it('records the extendable contract as the parent of each child', () => {
        const base = makeBase();
        const child = base.extend('A', {clientToServer: {ping: {errors: [SERVER_ERROR]}}});
        expect(getExtendableContractParent(child)).toBe(base);
    });

    it('throws eagerly on a duplicate extension name', () => {
        const base = makeBase();
        base.extend('Dup', {clientToServer: {a: {errors: [SERVER_ERROR]}}});
        expect(() => base.extend('Dup', {serverToClient: {b: {}}}))
            .toThrow(/Duplicate extension "Dup"/);
    });
});
