export interface FileDownloadResponse {
    fileName: string;
    contentType: string;
    buffer?: Buffer;
    url?: string;
}
