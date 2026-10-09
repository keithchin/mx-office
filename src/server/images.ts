/** A picture to send back, or why there isn't one (the bookshelf's and the changes window's pictures). */
export type ImageResult = { type: string; body: Buffer } | { status: number; error: string };
