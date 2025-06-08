/**
 * Helper type to make a key required for a given type object
 * ref: https://stackoverflow.com/a/72075415
 */
export type WithRequired<T, K extends keyof T> = T & Required<Pick<T, K>>;
