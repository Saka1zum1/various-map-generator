import { extractDateFromPanoId } from '@/composables/utils'
import gcoord from 'gcoord'

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

// Yandex
async function getFromYandex(
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
            const uri = `https://api-maps.yandex.com/services/panoramas/1.x/?l=stv&lang=en_US&origin=userAction&provider=streetview&ll=${lng},${lat}`
            const resp = await fetch(uri)
            const json = await resp.json()
            panoId = json?.data?.Data?.panoramaId
        }

        if (!panoId) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const uri = `https://api-maps.yandex.com/services/panoramas/1.x/?l=stv&lang=en_US&origin=userAction&provider=streetview&oid=${panoId}`
        const resp = await fetch(uri)
        const json = await resp.json()
        const result = json.data

        if (!result?.Data?.panoramaId) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const date = new Date(result.Data.timestamp * 1000)
        const heading = (result.Data.EquirectangularProjection.Origin[0] + 180) % 360

        const panorama: google.maps.StreetViewPanoramaData = {
            location: {
                pano: panoId,
                latLng: new google.maps.LatLng(result.Data.Point.coordinates[1], result.Data.Point.coordinates[0]),
                description: result.Data.Point.name
            },
            links: result.Annotation?.Thoroughfares?.map((r: any) => ({
                pano: new URL(r.Connection.href).searchParams.get('oid'),
                heading: 0,
            })) ?? [],
            tiles: {
                centerHeading: heading,
                tileSize: new google.maps.Size(256, 256),
                worldSize: new google.maps.Size(result.Data.Images.Zooms[0].width, result.Data.Images.Zooms[0].height),
                getTileUrl: () => '',
            },
            imageDate: date.toISOString().slice(0, 10),
            copyright: result.Author ? result.Author.name : '© Yandex Maps',
            time: [
                ...(result.Annotation?.HistoricalPanoramas?.map((r: any) => ({
                    pano: r.Connection.oid,
                    date: new Date(Number(r.Connection.oid.split('_').pop()) * 1000),
                })) ?? []),
                {
                    pano: panoId,
                    date: date,
                },
            ].sort((a, b) => a.date.getTime() - b.date.getTime()),
        }

        onCompleted(panorama, google.maps.StreetViewStatus.OK)
    } catch (err) {
        console.error('[Yandex] panorama fetch error:', err)
        onCompleted(null, google.maps.StreetViewStatus.UNKNOWN_ERROR)
    }
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
            panoId = json?.detail?.svid
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

        const date = extractDateFromPanoId(result.basic.svid.slice(8, 14))
        const [lng, lat] = gcoord.transform([result.addr.x_lng, result.addr.y_lat], gcoord.GCJ02, gcoord.WGS84)

        const panorama: google.maps.StreetViewPanoramaData = {
            location: {
                pano: panoId,
                latLng: new google.maps.LatLng(lat, lng),
                description: result.basic.append_addr
            },
            links: result.all_scenes?.map((r: any) => ({
                pano: r.svid,
                heading: 0,
            })) ?? [],
            tiles: {
                centerHeading: Number(result.basic.dir),
                tileSize: new google.maps.Size(512, 512),
                worldSize: new google.maps.Size(8192, 4096),
                getTileUrl: () => '',
            },
            imageDate: date,
            copyright: '© Tencent Maps',
            time: [
                ...(result.history?.nodes?.map((r: any) => ({
                    pano: r.svid,
                    date: new Date(extractDateFromPanoId(r.svid.slice(8, 14))),
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

// Baidu
async function getFromBaidu(
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

            const lat = typeof request.location.lat === 'function' ? request.location.lat() : request.location.lat
            const lng = typeof request.location.lng === 'function' ? request.location.lng() : request.location.lng

            const [bd09mcLng, bd09mcLat] = gcoord.transform([lng, lat], gcoord.WGS84, gcoord.BD09MC)
            const r = request.radius || 50
            const uri = `https://mapsv0.bdimg.com/?qt=qsdata&x=${bd09mcLng}&y=${bd09mcLat}&r=${r}`
            const resp = await fetch(uri)
            const json = await resp.json()
            panoId = json?.content?.id
        }

        if (!panoId) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const uri = `https://mapsv0.bdimg.com/?qt=sdata&sid=${panoId}`
        const resp = await fetch(uri)
        const json = await resp.json()
        const result = json.content[0]

        if (!result?.ID) {
            onCompleted(null, google.maps.StreetViewStatus.ZERO_RESULTS)
            return
        }

        const date = extractDateFromPanoId(result.Date)
        const [lng, lat] = gcoord.transform([result.X / 100, result.Y / 100], gcoord.BD09MC, gcoord.WGS84);
        const panorama: google.maps.StreetViewPanoramaData = {
            location: {
                pano: panoId,
                latLng: new google.maps.LatLng(lat, lng),
                description: result.Rname
            },
            links: result.Links?.map((r: any) => ({
                pano: r.PID,
                heading: 0,
            })) ?? [],
            tiles: {
                centerHeading: result.Heading,
                tileSize: new google.maps.Size(512, 512),
                worldSize: new google.maps.Size(8192, 4096),
                getTileUrl: () => '',
            },
            imageDate: date,
            copyright: '© Baidu Maps',
            time: [
                ...(result.TimeLine?.map((r: any) => ({
                    pano: r.ID,
                    date: new Date(extractDateFromPanoId(r.ID.slice(10, 16))),
                })) ?? []),
                {
                    pano: panoId,
                    date: new Date(date),
                },
            ].sort((a, b) => a.date.getTime() - b.date.getTime()),
        }

        onCompleted(panorama, google.maps.StreetViewStatus.OK)
    } catch (err) {
        console.error('[Baidu] panorama fetch error:', err)
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
        else if (provider === 'tencent') {
            await getFromTencent(request, onCompleted)
            return
        }
        else if (provider === 'baidu') {
            await getFromBaidu(request, onCompleted)
            return
        }
        else if (provider === 'yandex') {
            await getFromYandex(request, onCompleted)
            return
        }
        else if (provider === 'kakao') {
            await getFromKakao(request, onCompleted)
            return
        }
        onCompleted(null, google.maps.StreetViewStatus.UNKNOWN_ERROR)
    },
}


export default StreetViewProviders
