import { NextRequest, NextResponse } from "next/server";

/** Permanently maps a legacy root slug to its canonical canvas route. */
async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const destination = new URL(`/maps/${encodeURIComponent(slug)}`, request.url);

  return NextResponse.redirect(destination, 308);
}

export { GET };
