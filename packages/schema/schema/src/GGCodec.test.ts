import {describe, it, expect} from 'vitest';
import {GGCodec} from './GGCodec';
import {GGTransform} from './GGTransform';
import {IsString} from './schemas/IsString';
import {IsNumber} from './schemas/IsNumber';
import {IsObject} from './schemas/IsObject';
import {SERVER_ERROR} from './contract/ERROR';

describe('GGTransform', () => {

    describe('constructor', () => {

        it('should create transform with input and output schemas', () => {
            const transform = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
            expect(transform.inputSchema).toBe(IsString);
            expect(transform.outputSchema).toBe(IsNumber);
        });

        it('should freeze the instance', () => {
            const transform = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
            expect(Object.isFrozen(transform)).toBe(true);
        });
    });

    describe('encode()', () => {

        it('should validate input and transform on valid input', () => {
            const transform = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
            const result = transform.encode("42");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe(42);
            }
        });

        it('should return error on invalid input', () => {
            const transform = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
            const result = transform.encode(123 as any);
            expect(result.success).toBe(false);
        });

        it('should throw on invalid output (coding error)', () => {
            const badTransform = new GGTransform(IsString, IsNumber, () => "not a number" as any);
            expect(() => badTransform.encode("test")).toThrow();
        });
    });

    describe('transformTo()', () => {

        it('should chain transforms', () => {
            const stringToNumber = new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10));
            const numberToString = new GGTransform(IsNumber, IsString, (n) => n.toString());
            const chained = stringToNumber.transformTo(numberToString);

            expect(chained.inputSchema).toBe(IsString);
            expect(chained.outputSchema).toBe(IsString);

            const result = chained.encode("42");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe("42");
            }
        });
    });
});

describe('GGCodec', () => {

    const StringNumberCodec = new GGCodec({
        encode: new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10)),
        decode: new GGTransform(IsNumber, IsString, (n) => n.toString())
    });

    describe('constructor', () => {

        it('should freeze the instance', () => {
            expect(Object.isFrozen(StringNumberCodec)).toBe(true);
        });
    });

    describe('encode()', () => {

        it('should validate input and transform on valid input', () => {
            const result = StringNumberCodec.encode("42");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe(42);
            }
        });

        it('should return error on invalid input', () => {
            const result = StringNumberCodec.encode(123 as any);
            expect(result.success).toBe(false);
        });

        it('should throw on invalid output (coding error)', () => {
            const BadCodec = new GGCodec({
                encode: new GGTransform(IsString, IsNumber, () => "not a number" as any),
                decode: new GGTransform(IsNumber, IsString, (n) => n.toString())
            });

            expect(() => BadCodec.encode("test")).toThrow(SERVER_ERROR);
        });
    });

    describe('decode()', () => {

        it('should validate input and transform on valid input', () => {
            const result = StringNumberCodec.decode(42);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe("42");
            }
        });

        it('should return error on invalid input', () => {
            const result = StringNumberCodec.decode("not a number" as any);
            expect(result.success).toBe(false);
        });

        it('should throw on invalid output (coding error)', () => {
            const BadCodec = new GGCodec({
                encode: new GGTransform(IsString, IsNumber, (s) => parseInt(s, 10)),
                decode: new GGTransform(IsNumber, IsString, () => 123 as any)
            });

            expect(() => BadCodec.decode(42)).toThrow(SERVER_ERROR);
        });
    });

    describe('codecTo()', () => {

        const NumberBoolCodec = new GGCodec({
            encode: new GGTransform(IsNumber, IsString, (n) => n > 0 ? "true" : "false"),
            decode: new GGTransform(IsString, IsNumber, (s) => s === "true" ? 1 : 0)
        });

        it('should chain codecs for encode', () => {
            const chained = StringNumberCodec.codecTo(NumberBoolCodec);
            const result = chained.encode("42");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe("true");
            }
        });

        it('should chain codecs for decode', () => {
            const chained = StringNumberCodec.codecTo(NumberBoolCodec);
            const result = chained.decode("true");
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe("1");
            }
        });
    });

    describe('inputKeys', () => {

        it('should return keys from object schema input', () => {
            const HeaderSchema = IsObject({
                'authorization': IsString,
                'x-custom-token': IsString
            });
            const ContextSchema = IsObject({
                token: IsString
            });

            const codec = HeaderSchema.codecTo(ContextSchema, {
                encode: (headers) => ({token: headers['authorization']}),
                decode: (ctx) => ({authorization: ctx.token, 'x-custom-token': ''})
            });

            expect(codec.inputKeys).toEqual(['authorization', 'x-custom-token']);
        });

        it('should return undefined for non-object schema input', () => {
            expect(StringNumberCodec.inputKeys).toBeUndefined();
        });
    });

    describe('real-world example: header codec', () => {

        const AuthHeaderSchema = IsString;
        const AuthInfoSchema = IsObject({
            userId: IsString,
            token: IsString
        });

        const AuthHeaderCodec = new GGCodec({
            encode: new GGTransform(AuthInfoSchema, AuthHeaderSchema, (info) => `Bearer ${info.userId}:${info.token}`),
            decode: new GGTransform(AuthHeaderSchema, AuthInfoSchema, (header) => {
                const [, payload] = header.split(' ');
                const [userId, token] = payload.split(':');
                return {userId, token};
            })
        });

        it('should encode auth info to header', () => {
            const result = AuthHeaderCodec.encode({userId: 'user123', token: 'abc'});
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toBe('Bearer user123:abc');
            }
        });

        it('should decode header to auth info', () => {
            const result = AuthHeaderCodec.decode('Bearer user123:abc');
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toEqual({userId: 'user123', token: 'abc'});
            }
        });

        it('should return error for invalid header format', () => {
            const result = AuthHeaderCodec.decode(123 as any);
            expect(result.success).toBe(false);
        });
    });
});
