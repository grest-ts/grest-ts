import {callOn, GGTest} from "@grest-ts/testkit";
import {VALIDATION_ERROR, SERVER_ERROR} from "@grest-ts/schema";
import {FileUploadTestApi} from "../src/api/FileUploadTestApi";
import {MainRuntime} from "../src/main";
import {GGTestFile} from "@grest-ts/file/testkit";
import type {GGFile} from "@grest-ts/file";

describe("File upload tests", async () => {

    GGTest.startInline(MainRuntime);

    const api = callOn(FileUploadTestApi);

    // -------------------------------------------------
    // Basic file upload tests
    // -------------------------------------------------

    test('upload text file returns correct metadata', async () => {
        const file = GGTestFile.fromString('Hello, World!', 'hello.txt', 'text/plain');

        await api
            .uploadFile({file, description: 'A greeting'})
            .toMatchObject({
                fileName: 'hello.txt',
                mimeType: 'text/plain',
                size: 13,
                contentPreview: 'Hello, World!',
                description: 'A greeting'
            });
    });

    test('upload JSON file returns JSON content preview', async () => {
        const data = {name: 'Test', value: 123};
        const file = GGTestFile.json(data, 'config.json');

        const result = await api.uploadFile({file});

        expect(result.fileName).toBe('config.json');
        expect(result.mimeType).toBe('application/json');
        expect(result.contentPreview).toContain('"name"');
        expect(result.contentPreview).toContain('"Test"');
    });

    test('upload binary file returns [binary] preview', async () => {
        const file = GGTestFile.png1x1('image.png');

        const result = await api.uploadFile({file});

        expect(result.fileName).toBe('image.png');
        expect(result.mimeType).toBe('image/png');
        expect(result.contentPreview).toBe('[binary]');
    });

    test('upload CSV file works correctly', async () => {
        const file = GGTestFile.csv([
            ['Name', 'Age', 'City'],
            ['Alice', '30', 'New York'],
            ['Bob', '25', 'Los Angeles']
        ], 'users.csv');

        const result = await api.uploadFile({file});

        expect(result.fileName).toBe('users.csv');
        expect(result.mimeType).toBe('text/csv');
        expect(result.contentPreview).toContain('Name,Age,City');
    });

    // -------------------------------------------------
    // Multiple files + metadata tests
    // -------------------------------------------------

    test('upload multiple files with metadata', async () => {
        const files = [
            GGTestFile.fromString('File 1 content', 'file1.txt'),
            GGTestFile.fromString('File 2 content', 'file2.txt'),
            GGTestFile.png1x1('image.png')
        ];

        const result = await api.uploadMultiple({
            files,
            metadata: {
                tags: ['test', 'upload'],
                category: 'documents'
            }
        });

        expect(result.uploadedFiles).toHaveLength(3);
        expect(result.uploadedFiles[0].fileName).toBe('file1.txt');
        expect(result.uploadedFiles[1].fileName).toBe('file2.txt');
        expect(result.uploadedFiles[2].fileName).toBe('image.png');
        expect(result.metadata.tags).toEqual(['test', 'upload']);
        expect(result.metadata.category).toBe('documents');
    });

    // -------------------------------------------------
    // Image upload with constraints
    // -------------------------------------------------

    test('upload valid PNG image succeeds', async () => {
        const image = GGTestFile.png1x1('avatar.png');

        const result = await api.uploadImage({image});

        expect(result.fileName).toBe('avatar.png');
        expect(result.mimeType).toBe('image/png');
    });

    test('upload valid JPEG image succeeds', async () => {
        const image = GGTestFile.jpeg1x1('photo.jpg');

        const result = await api.uploadImage({image});

        expect(result.fileName).toBe('photo.jpg');
        expect(result.mimeType).toBe('image/jpeg');
    });

    test('upload non-image file fails validation', async () => {
        const textFile = GGTestFile.fromString('Not an image', 'document.txt', 'text/plain');

        await api
            .uploadImage({image: textFile})
            .toBeError(VALIDATION_ERROR);
    });

    test('upload oversized image fails validation', async () => {
        // Create a 6MB "image" (exceeds 5MB limit)
        const largeImage = GGTestFile.random(6 * 1024 * 1024, 'large.png', 'image/png');

        await api
            .uploadImage({image: largeImage})
            .toBeError(VALIDATION_ERROR);
    });

    // -------------------------------------------------
    // Edge cases
    // -------------------------------------------------

    test('upload empty file succeeds', async () => {
        const emptyFile = GGTestFile.fromBuffer(new Uint8Array(0), 'empty.txt', 'text/plain');

        const result = await api.uploadFile({file: emptyFile});

        expect(result.fileName).toBe('empty.txt');
        expect(result.size).toBe(0);
    });

    test('upload file without description', async () => {
        const file = GGTestFile.fromString('Content', 'test.txt');

        const result = await api.uploadFile({file});

        expect(result.fileName).toBe('test.txt');
        expect(result.description).toBeUndefined();
    });

    test('upload large text file truncates preview', async () => {
        const longContent = 'A'.repeat(200);
        const file = GGTestFile.fromString(longContent, 'long.txt');

        const result = await api.uploadFile({file});

        expect(result.contentPreview.length).toBeLessThanOrEqual(103); // 100 chars + "..."
        expect(result.contentPreview).toContain('...');
    });

    test('upload PDF file', async () => {
        const pdf = GGTestFile.pdf('document.pdf');

        const result = await api.uploadFile({file: pdf});

        expect(result.fileName).toBe('document.pdf');
        expect(result.mimeType).toBe('application/pdf');
        expect(result.contentPreview).toBe('[binary]');
    });

    // -------------------------------------------------
    // Download tests (DOWNLOAD_POST)
    // -------------------------------------------------

    test('download text file via POST returns correct file', async () => {
        const result: GGFile = await api.downloadFile({
            content: 'Hello, Download!',
            fileName: 'greeting.txt',
            mimeType: 'text/plain'
        });

        expect(result.name).toBe('greeting.txt');
        expect(result.mimeType).toBe('text/plain');
        const text = await result.text();
        expect(text).toBe('Hello, Download!');
    });

    test('download JSON file via POST returns correct content', async () => {
        const jsonContent = '{"key":"value","num":42}';
        const result: GGFile = await api.downloadFile({
            content: jsonContent,
            fileName: 'data.json',
            mimeType: 'application/json'
        });

        expect(result.name).toBe('data.json');
        expect(result.mimeType).toBe('application/json');
        const text = await result.text();
        expect(text).toBe(jsonContent);
    });

    // -------------------------------------------------
    // Download tests (DOWNLOAD_GET)
    // -------------------------------------------------

    test('download file by ID via GET returns correct file', async () => {
        const result: GGFile = await api.downloadById({id: 'txt-1'});

        expect(result.name).toBe('hello.txt');
        expect(result.mimeType).toBe('text/plain');
        const text = await result.text();
        expect(text).toBe('Hello from download!');
    });

    test('download JSON file by ID via GET returns correct file', async () => {
        const result: GGFile = await api.downloadById({id: 'json-1'});

        expect(result.name).toBe('data.json');
        expect(result.mimeType).toBe('application/json');
        const text = await result.text();
        expect(text).toBe('{"key":"value"}');
    });

    test('download non-existent file by ID returns SERVER_ERROR', async () => {
        await api
            .downloadById({id: 'nonexistent'})
            .toBeError(SERVER_ERROR);
    });

});
