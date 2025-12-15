export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> }
) {
  const { z, x, y } = await ctx.params;

  // Ici y DOIT déjà contenir "23152.png" (car ton route est /[y]/ et tu appelles .../23152.png)
  // Donc on n'ajoute PAS ".png" encore une fois.
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}`;

  try {
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      return new Response(`Upstream error ${res.status}`, { status: res.status });
    }

    const buf = await res.arrayBuffer();

    return new Response(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err: any) {
    console.error("Tile fetch failed:", url, err?.message || err);
    return new Response(`Tile fetch failed: ${err?.message || "unknown"}`, {
      status: 502,
    });
  }
}