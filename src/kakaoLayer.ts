import * as L from 'leaflet';
import 'proj4leaflet';

const daumCRS = new L.Proj.CRS(
    "EPSG:5181",
    "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
    {
        resolutions: [
            2048, 1024, 512, 256, 128, 64,
            32, 16, 8, 4, 2, 1, 0.5, 0.25
        ] as const,
        origin: [-30000, -60000] as [number, number],
        bounds: L.bounds(
            [-30000 - Math.pow(2, 19) * 4, -60000],
            [-30000 + Math.pow(2, 19) * 5, -60000 + Math.pow(2, 19) * 5]
        )
    }
);

function isInKoreaBbox(lon: number, lat: number): boolean {
    return true//lon >= 124.5 && lon <= 131.9 && lat >= 33.0 && lat <= 39.5;
}

function toKakaoZoom(leafletZoom: number): number {
  const maxZoom = 13;
  return maxZoom - leafletZoom;
}

const TILE_SIZE = 512;

async function renderTile(
    bbox: [number, number, number, number],
    zoom: number,
    signal?: AbortSignal
): Promise<HTMLCanvasElement> {

    const topLeftTile = daumCRS.latLngToPoint(L.latLng(bbox[3], bbox[0]), zoom).divideBy(TILE_SIZE);
    const bottomRightTile = daumCRS.latLngToPoint(L.latLng(bbox[1], bbox[2]), zoom).divideBy(TILE_SIZE);
    const topLeftOffset = [
        (topLeftTile.x - Math.floor(topLeftTile.x)) * TILE_SIZE,
        (topLeftTile.y - Math.floor(topLeftTile.y)) * TILE_SIZE
    ];
    const horzTileCount = Math.floor(bottomRightTile.x) - Math.floor(topLeftTile.x);
    const vertTileCount = Math.floor(bottomRightTile.y) - Math.floor(topLeftTile.y);

    const helper = new OffscreenCanvas(
        TILE_SIZE * (horzTileCount + 1),
        TILE_SIZE * (vertTileCount + 1)
    );
    const ctx = helper.getContext("2d")!;

    for (let x = Math.floor(topLeftTile.x); x <= Math.floor(bottomRightTile.x); x++) {
        for (let y = Math.floor(topLeftTile.y); y <= Math.floor(bottomRightTile.y); y++) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
            
            const tileUrl = `https://mts.daumcdn.net/api/v1/tile/PNG_RV02/v07_zxrda/latest/${zoom}/${x}/${y}.png`;
            const img = new Image();
            img.src = tileUrl;

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error(`Failed to load tile: ${tileUrl}`));
            });

            ctx.drawImage(
                img,
                (x - Math.floor(topLeftTile.x)) * TILE_SIZE,
                (y - Math.floor(topLeftTile.y)) * TILE_SIZE
            );
        }
    }

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = TILE_SIZE;
    finalCanvas.height = TILE_SIZE;
    const finalCtx = finalCanvas.getContext("2d")!;
    finalCtx.drawImage(
        helper,
        topLeftOffset[0],
        topLeftOffset[1],
        TILE_SIZE,
        TILE_SIZE,
        0,
        0,
        TILE_SIZE,
        TILE_SIZE
    );

    return finalCanvas;
}

export class KakaoLayer extends L.GridLayer {
    filter: string;
    private tiles = new Map<HTMLCanvasElement, AbortController>();

    constructor(options: L.GridLayerOptions & { filter?: string } = {}) {
        super(options);
        this.filter = options.filter || "";
    }

    createTile(coords: L.Coords, done: L.DoneCallback): HTMLCanvasElement {
        const tile = document.createElement("canvas");
        tile.width = TILE_SIZE;
        tile.height = TILE_SIZE;
        coords.z=toKakaoZoom(coords.z)

        const topLeftPixel = {
            x: coords.x * TILE_SIZE,
            y: coords.y * TILE_SIZE
        };
        const bottomRightPixel = {
            x: (coords.x + 1) * TILE_SIZE,
            y: (coords.y + 1) * TILE_SIZE
        };

        const topLeft = daumCRS.pointToLatLng(L.point(topLeftPixel.x, topLeftPixel.y), coords.z);
        const bottomRight = daumCRS.pointToLatLng(L.point(bottomRightPixel.x, bottomRightPixel.y), coords.z);
        if (
            !isInKoreaBbox(topLeft.lng, topLeft.lat) &&
            !isInKoreaBbox(bottomRight.lng, bottomRight.lat)
        ) {
            done(undefined, tile);
            return tile;
        }
        const controller = new AbortController();

        renderTile(
            [topLeft.lng, bottomRight.lat, bottomRight.lng, topLeft.lat],
            coords.z,
            controller.signal
        )
            .then(canvas => {
                const ctx = tile.getContext("2d");
                ctx?.drawImage(canvas, 0, 0);
                tile.style.filter = this.filter;
                done(undefined, tile);
            })
            .catch(err => {
                if (err.name === "AbortError") {
                    done(undefined, tile);
                } else {
                    done(err, tile);
                }
            });

        this.tiles.set(tile, controller);
        return tile;
    }

    unloadTile(tile: HTMLElement) {
        const controller = this.tiles.get(tile as HTMLCanvasElement);
        if (controller) {
            controller.abort();
            this.tiles.delete(tile as HTMLCanvasElement);
        }
    }
}
