import { describe, expect, it } from 'vitest'
import { packProject, unpackProject } from '../src/backup'
import { newProject, type AnimationData, type SpriteSheet } from '../src/types'

function makeAnim(id: string, videoContent: string): AnimationData {
    return {
        id,
        name: id,
        video: new Blob([videoContent], { type: 'video/mp4' }),
        videoName: `${id}.mp4`,
        extractFps: 23,
        maxDim: 720,
        chroma: {
            enabled: true,
            key: [0, 177, 64],
            similarity: 0.054,
            smoothness: 0.202,
            spill: 0.225,
            halo: 0.312,
        },
        selected: [true, false, true],
        speed: [1, 1, 2],
        curve: [
            { t: 0, v: 1 },
            { t: 1, v: 1 },
        ],
        drift: { x: 2.5, y: -1 },
        crossfade: 3,
        fps: 23,
        align: { dx: 4, dy: -2, scale: 1.1 },
        thumb: new Blob(['thumb-png'], { type: 'image/png' }),
    }
}

function makeSheet(projectId: string): SpriteSheet {
    return {
        id: 'sheet-1',
        projectId,
        version: 2,
        createdAt: 1765000000000,
        cell: { w: 100, h: 100, pivotX: 0.5, pivotY: 1, margin: 8 },
        exportCfg: { scale: 1, padding: 0, colors: 256, columns: 0 },
        corrections: [
            {
                id: 'duplicados:a',
                kind: 'duplicados',
                severity: 'info',
                target: { scope: 'frame', animId: 'a', frames: [3, 5] },
                label: 'frames duplicados',
                params: { limiar: 0.5 },
                accepted: true,
                adjusted: false,
            },
        ],
        anims: [
            {
                animId: 'a',
                name: 'a',
                slug: 'a',
                frameCount: 2,
                fps: 23,
                crossfade: 0,
                columns: 2,
                rows: 1,
                width: 200,
                height: 100,
                cellW: 100,
                cellH: 100,
                durationsMs: [43, 86],
                keptPositions: [0, 2],
            },
        ],
        blobs: [new Blob(['png-atlas-bytes'], { type: 'image/png' })],
        stateHash: 'abc123',
    }
}

describe('pack/unpack do .sfproj', () => {
    it('roundtrip preserva projeto, animações, referências e spritesheets', async () => {
        const p = newProject('p1', 'Herói de Teste')
        p.animations.push(makeAnim('a', 'video-bytes-aaa'), makeAnim('b', 'video-bytes-bbb'))
        p.refs.push({ id: 'r1', name: 'ref.png', blob: new Blob(['ref-bytes'], { type: 'image/png' }) })
        const sheets = [makeSheet('p1')]

        const bytes = await packProject(p, sheets)
        const out = unpackProject(bytes)

        // metadados intactos
        expect(out.project.id).toBe('p1')
        expect(out.project.name).toBe('Herói de Teste')
        expect(out.project.animations).toHaveLength(2)
        expect(out.project.animations[0].chroma).toEqual(p.animations[0].chroma)
        expect(out.project.animations[0].drift).toEqual({ x: 2.5, y: -1 })
        expect(out.project.animations[0].selected).toEqual([true, false, true])
        expect(out.sheets).toHaveLength(1)
        expect(out.sheets[0].corrections[0].target.frames).toEqual([3, 5])
        expect(out.sheets[0].anims[0].durationsMs).toEqual([43, 86])

        // blobs com conteúdo e type preservados
        expect(await out.project.animations[0].video.text()).toBe('video-bytes-aaa')
        expect(out.project.animations[0].video.type).toBe('video/mp4')
        expect(await out.project.animations[1].video.text()).toBe('video-bytes-bbb')
        expect(await out.project.animations[0].thumb!.text()).toBe('thumb-png')
        expect(await out.project.refs[0].blob.text()).toBe('ref-bytes')
        expect(out.project.refs[0].blob.type).toBe('image/png')
        expect(await out.sheets[0].blobs[0].text()).toBe('png-atlas-bytes')
    })

    it('tolera backup sem sheets.json e sem refs', async () => {
        const p = newProject('p2', 'minimal')
        p.animations.push(makeAnim('a', 'v'))
        const bytes = await packProject(p, [])
        const out = unpackProject(bytes)
        expect(out.sheets).toEqual([])
        expect(out.project.refs).toEqual([])
    })
})
