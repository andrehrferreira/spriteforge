import { describe, expect, it } from 'vitest'
import { dataUrlToBlob, extractImages } from '../src/genimage'

const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('extractImages', () => {
    it('extrai data URLs da resposta do chat/completions', () => {
        const res = {
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: 'aqui está',
                        images: [
                            { type: 'image_url', image_url: { url: PNG_1PX } },
                            { type: 'image_url', image_url: { url: 'data:image/webp;base64,AAAA' } },
                        ],
                    },
                },
            ],
        }
        const out = extractImages(res)
        expect(out).toHaveLength(2)
        expect(out[0]).toBe(PNG_1PX)
    })

    it('ignora urls que não são data de imagem e respostas sem images', () => {
        expect(
            extractImages({
                choices: [{ message: { images: [{ image_url: { url: 'https://x/y.png' } }] } }],
            }),
        ).toEqual([])
        expect(extractImages({ choices: [{ message: { content: 'sem imagem' } }] })).toEqual([])
        expect(extractImages({})).toEqual([])
        expect(extractImages(null)).toEqual([])
        expect(extractImages('texto')).toEqual([])
    })
})

describe('dataUrlToBlob', () => {
    it('decodifica base64 com o MIME certo', async () => {
        const blob = dataUrlToBlob(PNG_1PX)
        expect(blob.type).toBe('image/png')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        // assinatura PNG
        expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })
})
