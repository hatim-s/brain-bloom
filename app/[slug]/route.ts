import { NextRequest, NextResponse } from "next/server";

/** Temporarily maps a legacy root slug to its canonical canvas route. */
async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const destination = new URL(`/maps/${encodeURIComponent(slug)}`, request.url);

  // Only GET is exported, so method preservation buys nothing. A 307 also
  // avoids browsers permanently caching a legacy slug mapping.
  return NextResponse.redirect(destination, 307);
}

export { GET };
