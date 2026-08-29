import { NextResponse } from 'next/server';

export async function GET() {
  return new NextResponse(
    JSON.stringify({
      url: "https://apex-miner.vercel.app",
      name: "ApexMiner",
      iconUrl: "https://avatars.githubusercontent.com/u/108391089?s=200&v=4"
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    }
  );
}

// هذه الدالة ضرورية جداً لتجاوز الفحص الأمني للمحافظ
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
