import { TypeCompiler } from '@grest-ts/schema';
import {
    createSimpleSchema,
    createNestedSchema,
    createRefineSchema,
    createDiscriminatedSchema,
    createRecursiveSchema,
    createTupleSchema,
    createBigStringSchema,
    createBigArraySchema
} from './data';
import * as fs from 'fs';
import * as path from 'path';

const outDir = path.join(import.meta.dirname, 'generated');
fs.mkdirSync(outDir, { recursive: true });

new TypeCompiler()
    .add('Simple', createSimpleSchema())
    .add('Nested', createNestedSchema())
    .add('Refine', createRefineSchema())
    .add('Discriminated', createDiscriminatedSchema())
    .add('Recursive', createRecursiveSchema())
    .add('Tuple', createTupleSchema())
    .add('BigString', createBigStringSchema())
    .add('BigArray', createBigArraySchema())
    .write(path.join(outDir, 'validators.js'));

console.log('Generated:', path.join(outDir, 'validators.js'));
