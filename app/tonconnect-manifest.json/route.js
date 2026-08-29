import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    url: "https://apex-miner.vercel.app",
    name: "ApexMiner",
    iconUrl: "https://avatars.githubusercontent.com/u/108391089?s=200&v=4"
  });
}
