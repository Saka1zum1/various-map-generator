import { extractDateFromPanoId } from '@/composables/utils'

let svService: google.maps.StreetViewService | null = null

function getStreetViewService() {
    if (!svService) {
        svService = new google.maps.StreetViewService()
    }
    return svService
}

// Google
function getFromGoogle(
    request: google.maps.StreetViewLocationRequest,
    onCompleted: (
        res: google.maps.StreetViewPanoramaData | null,
        status: google.maps.StreetViewStatus,
    ) => void,
) {
    const sv = getStreetViewService()
    sv.getPanorama(request, onCompleted)
}

// Tencent
async function getFromTencent(
    request: google.maps.StreetViewLocationRequest & { pano?: string },
    onCompleted: (
        res: google.maps.StreetViewPanoramaData | null,
        status: google.maps.StreetViewStatus,
    ) => void,
) {
    try {
        let panoId: string | undefined

        if (request.pano) {
            panoId = request.pano
        } else if (request.location) {
            const { lat, lng } = request.location
            const r = request.radius || 50
            const uri = `https://sv.map.qq.com/xf?output=json&lng=${lng}&lat=${lat}&r=${r}`
            const resp = await fetch(uri)
            const json = await resp.json()
            panoId = json?.detail?.svid?.toString()
        }

        if (!panoId) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const uri = `https://sv.map.qq.com/sv?output=json&svid=${panoId}`
        const resp = await fetch(uri)
        const json = await resp.json()
        const result = json.detail

        if (!result?.basic?.svid) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const date = extractDateFromPanoId(result.basic.svid)
        const heading = Number(result.basic.dir)

        const panorama: google.maps.StreetViewPanoramaData = {
            location: {
                pano: panoId,
                latLng: new google.maps.LatLng(result.addr.y_lat, result.addr.x_lng),
                description: result.basic.append_addr
            },
            links: result.all_scenes?.map((r: any) => ({
                pano: r.svid.toString(),
                heading: 0,
            })) ?? [],
            tiles: {
                centerHeading: heading,
                tileSize: new google.maps.Size(512, 512),
                worldSize: new google.maps.Size(8192, 4096),
                getTileUrl: () => '',
            },
            imageDate: date,
            copyright: '© Tencent Maps',
            time: [
                ...(result.history?.nodes?.map((r: any) => ({
                    pano: r.svid.toString(),
                    date: new Date(extractDateFromPanoId(r.svid)),
                })) ?? []),
                {
                    pano: panoId,
                    date: new Date(date),
                },
            ].sort((a, b) => a.date.getTime() - b.date.getTime()),
        }

        onCompleted(panorama, google.maps.StreetViewStatus.OK)
    } catch (err) {
        console.error('[Tencent] panorama fetch error:', err)
        onCompleted(null, google.maps.StreetViewStatus.UNKNOWN_ERROR)
    }
}

// Kakao
async function getFromKakao(
    request: google.maps.StreetViewLocationRequest & { pano?: string },
    onCompleted: (
        res: google.maps.StreetViewPanoramaData | null,
        status: google.maps.StreetViewStatus,
    ) => void,
) {
    try {
        let uri: string

        if (request.pano) {
            uri = `https://rv.map.kakao.com/roadview-search/v2/node/${request.pano}?SERVICE=glpano`
        } else if (request.location) {
            const { lat, lng } = request.location

            const rad = request.radius || 50
            uri = `https://rv.map.kakao.com/roadview-search/v2/nodes?PX=${lng}&PY=${lat}&RAD=${rad}&PAGE_SIZE=1&INPUT=wgs&TYPE=w&SERVICE=glpano`
        } else {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const resp = await fetch(uri)
        const json = await resp.json()
        const result = json.street_view?.street ?? json.street_view?.streetList?.[0]

        if (!result) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const date = result.shot_date
        const panoId = result.id.toString()
        const heading = (parseFloat(result.angle) + 180) % 360

        const res: google.maps.StreetViewPanoramaData = {
            location: {
                pano: panoId,
                latLng: new google.maps.LatLng(result.wgsy, result.wgsx),
                description: result.addr,
            },
            links: result.spot?.map((r: any) => ({
                pano: r.id.toString(),
                heading: (parseFloat(r.pan) % 180) + (heading > 180 ? 180 : 0),
            })) ?? [],
            imageDate: date,
            tiles: {
                centerHeading: heading,
                getTileUrl: () => '',
                tileSize: new google.maps.Size(512, 512),
                worldSize: new google.maps.Size(8192, 4096),
            },
            copyright: '© Kakao Maps',
            time: [
                ...(result.past?.map((r: any) => ({
                    date: new Date(r.shot_date),
                    pano: r.id.toString(),
                })) ?? []),
                {
                    date: new Date(date),
                    pano: panoId,
                },
            ].sort((a, b) => a.date.getTime() - b.date.getTime()),
        }

        onCompleted(res, google.maps.StreetViewStatus.OK)
    } catch (err) {
        console.error('[Kakao] panorama fetch error:', err)
        onCompleted(null, google.maps.StreetViewStatus.UNKNOWN_ERROR)
    }
}

const StreetViewProviders = {
    getPanorama: async (
        provider: string,
        request: google.maps.StreetViewLocationRequest & { pano?: string },
        onCompleted: (
            res: google.maps.StreetViewPanoramaData | null,
            status: google.maps.StreetViewStatus,
        ) => void,
    ) => {
        if (provider === 'google') {
            getFromGoogle(request, onCompleted)
            return
        }
        if (provider === 'tencent') {
            await getFromTencent(request, onCompleted)
            return
        }
        if (provider === 'kakao') {
            await getFromKakao(request, onCompleted)
            return
        }
        onCompleted(null, google.maps.StreetViewStatus.UNKNOWN_ERROR)
    },
}


export default StreetViewProviders
