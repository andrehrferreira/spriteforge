declare module 'upng-js' {
    /**
     * Codifica frames RGBA em PNG.
     * @param imgs buffers RGBA (um por frame; usamos só um)
     * @param w largura
     * @param h altura
     * @param cnum 0 = sem perda (32-bit), N > 0 = quantiza para N cores (PNG-8)
     */
    export function encode(
        imgs: ArrayBuffer[],
        w: number,
        h: number,
        cnum: number,
        dels?: number[],
    ): ArrayBuffer
    const UPNG: { encode: typeof encode }
    export default UPNG
}
