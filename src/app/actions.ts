'use server'

import { Innertube } from 'youtubei.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export type SubtitleBlock = {
  text: string;
  offset: number;
  duration: number;
};

export async function processVideo(videoUrl: string) {
  try {
    // Extract video ID from URL
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      throw new Error("Invalid YouTube URL. Please enter a valid YouTube link.");
    }

    console.log("Fetching transcript for video ID:", videoId);

    // 1. Fetch transcript from YouTube using youtubei.js
    const youtube = await Innertube.create();
    const info = await youtube.getInfo(videoId);
    
    // Get available caption tracks
    const transcriptInfo = await info.getTranscript();
    
    if (!transcriptInfo?.transcript?.content?.body?.initial_segments) {
      throw new Error("No transcript found. The video may not have captions enabled.");
    }

    const segments = transcriptInfo.transcript.content.body.initial_segments;
    
    if (!segments || segments.length === 0) {
      throw new Error("No transcript segments found.");
    }

    console.log(`Success! Found ${segments.length} transcript entries`);

    // Convert to our format - filter out section headers and only keep segments with text
    const transcript: SubtitleBlock[] = segments
      .filter((segment): segment is typeof segment & { start_ms: string; end_ms: string; snippet: { text: string } } => {
        return 'start_ms' in segment && 'snippet' in segment && segment.snippet?.text !== undefined;
      })
      .map((segment) => ({
        text: segment.snippet.text || '',
        offset: parseInt(segment.start_ms) || 0,
        duration: (parseInt(segment.end_ms) || 0) - (parseInt(segment.start_ms) || 0),
      }));

    console.log("Transcript sample:", transcript.slice(0, 2));

    // 2. Translate in chunks (Gemini has token limits)
    const chunkSize = 50;
    const translatedSubs: SubtitleBlock[] = [];

    for (let i = 0; i < transcript.length; i += chunkSize) {
      const chunk = transcript.slice(i, i + chunkSize);
      console.log(`Translating chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(transcript.length/chunkSize)}...`);
      const translated = await translateChunk(chunk);
      translatedSubs.push(...translated);
    }

    return { success: true, data: translatedSubs };

  } catch (error: unknown) {
    console.error("Processing Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return { 
      success: false, 
      error: errorMessage
    };
  }
}

async function translateChunk(chunk: { text: string; offset: number; duration: number }[]): Promise<SubtitleBlock[]> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  
  const prompt = `You are a professional Vietnamese translator specializing in natural, conversational language.

Translate the following English subtitle data to Vietnamese with these STRICT RULES:

1. Keep "offset" and "duration" values EXACTLY the same - DO NOT MODIFY
2. Only translate the "text" field
3. Use natural, conversational Vietnamese:
   - Use "mình" instead of "tôi" for casual contexts
   - Use "bạn" for "you" in friendly contexts
   - Avoid overly formal or literary language
   - Sound like a native Vietnamese speaker
4. Preserve the meaning and tone of the original
5. Return ONLY a valid JSON array, no markdown formatting

Input:
${JSON.stringify(chunk)}

Output format: [{"text":"translated text","offset":123,"duration":456},...]`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const text = response.text();

  // Clean markdown if present
  const cleanedText = text
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();
  
  return JSON.parse(cleanedText);
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}
