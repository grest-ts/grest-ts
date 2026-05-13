import {
    IFileUploadTestApi,
    UploadFileRequest,
    UploadFileResponse,
    UploadMultipleRequest,
    UploadMultipleResponse,
    UploadImageRequest,
    UploadImageResponse,
    UploadViaUnionRequest,
    UploadViaUnionResponse,
    DownloadFileRequest,
    DownloadByIdRequest
} from "../api/FileUploadTestApi";
import {GGFile} from "@grest-ts/schema-file";
import {SERVER_ERROR} from "@grest-ts/schema";

export class FileUploadTestService implements IFileUploadTestApi {

    public async uploadFile(request: UploadFileRequest): Promise<UploadFileResponse> {
        const {file, description} = request;

        // Read file content
        const buffer = await file.buffer();

        // Try to get text preview for text files
        let contentPreview: string;
        if (file.mimeType.startsWith('text/') ||
            file.mimeType === 'application/json' ||
            file.mimeType === 'application/xml') {
            const text = new TextDecoder().decode(buffer);
            contentPreview = text.substring(0, 100);
            if (text.length > 100) {
                contentPreview += '...';
            }
        } else {
            contentPreview = '[binary]';
        }

        return {
            fileName: file.name,
            mimeType: file.mimeType,
            size: file.size,
            contentPreview,
            description
        };
    }

    public async uploadMultiple(request: UploadMultipleRequest): Promise<UploadMultipleResponse> {
        const {files, metadata} = request;

        const uploadedFiles = await Promise.all(
            files.map(async (file) => {
                // Consume the file to verify it works
                await file.buffer();

                return {
                    fileName: file.name,
                    mimeType: file.mimeType,
                    size: file.size
                };
            })
        );

        return {
            uploadedFiles,
            metadata
        };
    }

    public async uploadImage(request: UploadImageRequest): Promise<UploadImageResponse> {
        const {image} = request;

        // Read image to verify it works
        await image.buffer();

        return {
            fileName: image.name,
            mimeType: image.mimeType,
            size: image.size
        };
    }

    public async uploadViaUnion(request: UploadViaUnionRequest): Promise<UploadViaUnionResponse> {
        const {secret} = request;
        if (secret.via === "file") {
            const text = await secret.file.text();
            return {via: "file", contentPreview: text.substring(0, 100)};
        }
        return {via: "text", contentPreview: secret.text.substring(0, 100)};
    }

    public async downloadFile(request: DownloadFileRequest): Promise<GGFile> {
        return GGFile.fromString(request.content, request.fileName, request.mimeType);
    }

    public async downloadById(request: DownloadByIdRequest): Promise<GGFile> {
        // Simulate a simple file store lookup
        const files: Record<string, { content: string, name: string, mimeType: string }> = {
            "txt-1": {content: "Hello from download!", name: "hello.txt", mimeType: "text/plain"},
            "json-1": {content: '{"key":"value"}', name: "data.json", mimeType: "application/json"},
        };
        const entry = files[request.id];
        if (!entry) {
            throw new SERVER_ERROR({displayMessage: "File not found: " + request.id});
        }
        return GGFile.fromString(entry.content, entry.name, entry.mimeType);
    }
}
