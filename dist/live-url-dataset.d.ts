export interface LiveUrlRecord {
    url: string;
    sourceSitemap: string | undefined;
}
export interface LiveUrlDataset {
    readonly totalUrls: number;
    readonly replayable: boolean;
    records(): AsyncIterable<LiveUrlRecord>;
    close(): Promise<void>;
}
export interface LiveUrlDatasetCollector {
    add(record: LiveUrlRecord): Promise<void>;
    finish(): Promise<LiveUrlDataset>;
    close(): Promise<void>;
}
export interface LiveUrlDatasetCollectorOptions {
    saveUrlsTo?: string | undefined;
    saveUrlDetailsTo?: string | undefined;
    replayable: boolean;
}
export interface OpenLiveUrlDatasetOptions {
    onProgress?: ((message: string) => void) | undefined;
}
export declare class LiveUrlDatasetError extends Error {
    constructor(message: string);
}
export declare function openLiveUrlDataset(path: string, options?: OpenLiveUrlDatasetOptions): Promise<LiveUrlDataset>;
export declare function createLiveUrlDatasetCollector(options: LiveUrlDatasetCollectorOptions): Promise<LiveUrlDatasetCollector>;
