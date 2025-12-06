'use client'

import { useState, useRef, useEffect } from 'react';
import { processVideo, type SubtitleBlock } from './actions';
import { generateSRT } from '@/lib/utils';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Download, Loader2, Play, AlertCircle, FileText, Monitor } from 'lucide-react';

// YouTube IFrame API types
declare global {
  interface Window {
    YT: {
      Player: new (elementId: string, config: {
        videoId: string;
        events: {
          onReady: (event: { target: YTPlayer }) => void;
          onStateChange: (event: { data: number }) => void;
        };
        playerVars?: {
          autoplay?: number;
          controls?: number;
          rel?: number;
        };
      }) => YTPlayer;
      PlayerState: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YTPlayer {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [subtitles, setSubtitles] = useState<SubtitleBlock[]>([]);
  const [videoReady, setVideoReady] = useState(false);
  const [error, setError] = useState('');
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'player'>('player');
  const [activeSubIndex, setActiveSubIndex] = useState(-1);
  
  const playerRef = useRef<YTPlayer | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load YouTube IFrame API
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Initialize player when video is ready
  useEffect(() => {
    if (!videoReady || !url) return;

    const videoId = getVideoId(url);
    if (!videoId) return;

    const initPlayer = () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }

      playerRef.current = new window.YT.Player('youtube-player', {
        videoId: videoId,
        events: {
          onReady: () => {
            console.log('Player ready');
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              startSubtitleSync();
            } else {
              stopSubtitleSync();
            }
          },
        },
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
        },
      });
    };

    if (window.YT && window.YT.Player) {
      initPlayer();
    } else {
      window.onYouTubeIframeAPIReady = initPlayer;
    }

    return () => {
      stopSubtitleSync();
      if (playerRef.current) {
        playerRef.current.destroy();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoReady, url]);

  const startSubtitleSync = () => {
    if (intervalRef.current) return;
    
    intervalRef.current = setInterval(() => {
      if (playerRef.current) {
        const time = playerRef.current.getCurrentTime() * 1000; // Convert to ms
        
        // Find current subtitle
        const index = subtitles.findIndex(
          (sub) => time >= sub.offset && time < sub.offset + sub.duration
        );
        
        if (index !== -1) {
          setCurrentSubtitle(subtitles[index].text);
          setActiveSubIndex(index);
          
          // Auto-scroll to active subtitle in list view
          if (subtitleRefs.current[index]) {
            subtitleRefs.current[index]?.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
          }
        } else {
          setCurrentSubtitle('');
          setActiveSubIndex(-1);
        }
      }
    }, 100);
  };

  const stopSubtitleSync = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const handleProcess = async () => {
    if (!url) return;
    
    setLoading(true);
    setError('');
    setSubtitles([]);
    setVideoReady(false);
    setCurrentSubtitle('');
    
    const result = await processVideo(url);
    
    if (result.success && result.data) {
      setSubtitles(result.data);
      setVideoReady(true);
    } else {
      setError(result.error || 'An error occurred');
    }
    
    setLoading(false);
  };

  const downloadSRT = () => {
    if (subtitles.length === 0) return;
    const srtContent = generateSRT(subtitles);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'vietnamese_subtitles.srt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);
  };

  const getVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const seekToSubtitle = (offset: number) => {
    if (playerRef.current) {
      playerRef.current.seekTo(offset / 1000, true);
      playerRef.current.playVideo();
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-3 pt-8">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 text-transparent bg-clip-text">
            Video Transcript
          </h1>
          <p className="text-slate-400 text-lg">
            Dịch phụ đề YouTube sang tiếng Việt tự nhiên với AI
          </p>
        </div>

        {/* URL Input */}
        <div className="max-w-3xl mx-auto">
          <Card className="bg-slate-900/50 backdrop-blur-sm border-slate-800">
            <CardContent className="p-6">
              <div className="flex flex-col md:flex-row gap-3">
                <Input
                  placeholder="Dán link YouTube vào đây..."
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setError('');
                  }}
                  className="flex-1 bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                />
                <Button
                  onClick={handleProcess}
                  disabled={loading || !url}
                  className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                >
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" />
                      Đang dịch...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Dịch ngay
                    </>
                  )}
                </Button>
              </div>
              
              {error && (
                <div className="mt-4 flex items-center gap-2 text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg p-3">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {loading && (
                <div className="mt-4 text-center text-slate-400">
                  <p className="text-sm">Đang tải và dịch phụ đề... Có thể mất 1-2 phút</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Video Player & Subtitles */}
        {videoReady && (
          <div className="space-y-4">
            {/* View Mode Toggle & Download */}
            <div className="flex justify-center gap-2 flex-wrap">
              <Button
                variant={viewMode === 'player' ? 'default' : 'outline'}
                onClick={() => setViewMode('player')}
                className={viewMode === 'player' ? 'bg-blue-600' : 'border-slate-700'}
              >
                <Monitor className="mr-2 h-4 w-4" />
                Xem với phụ đề
              </Button>
              <Button
                variant={viewMode === 'list' ? 'default' : 'outline'}
                onClick={() => setViewMode('list')}
                className={viewMode === 'list' ? 'bg-blue-600' : 'border-slate-700'}
              >
                <FileText className="mr-2 h-4 w-4" />
                Xem danh sách
              </Button>
              <Button
                onClick={downloadSRT}
                variant="outline"
                className="border-slate-700 hover:bg-slate-800"
              >
                <Download className="mr-2 h-4 w-4" />
                Tải .SRT
              </Button>
            </div>

            {viewMode === 'player' ? (
              /* Player View with Overlay Subtitles */
              <div className="max-w-4xl mx-auto">
                <Card className="bg-slate-900/50 border-slate-800 overflow-hidden">
                  <div className="relative">
                    {/* YouTube Player */}
                    <div className="aspect-video bg-black">
                      <div id="youtube-player" className="w-full h-full" />
                    </div>
                    
                    {/* Subtitle Overlay */}
                    <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
                      <div className="flex justify-center">
                        {currentSubtitle && (
                          <div className="bg-black/80 backdrop-blur-sm px-6 py-3 rounded-lg max-w-[90%]">
                            <p className="text-white text-lg md:text-xl text-center font-medium leading-relaxed">
                              {currentSubtitle}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
                
                <p className="text-center text-slate-500 text-sm mt-4">
                  💡 Nhấn play để xem video với phụ đề tiếng Việt
                </p>
              </div>
            ) : (
              /* List View */
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Video */}
                <Card className="bg-slate-900/50 border-slate-800 overflow-hidden">
                  <div className="aspect-video bg-black">
                    <div id="youtube-player" className="w-full h-full" />
                  </div>
                </Card>

                {/* Subtitle List */}
                <Card className="bg-slate-900/50 border-slate-800 h-[500px]">
                  <CardContent className="p-6 h-full flex flex-col">
                    <h3 className="font-semibold text-lg mb-4">
                      📝 Phụ đề tiếng Việt ({subtitles.length} dòng)
                    </h3>
                    <ScrollArea className="flex-1">
                      <div className="space-y-2 pr-4">
                        {subtitles.map((sub, i) => (
                          <div
                            key={i}
                            ref={(el) => { subtitleRefs.current[i] = el; }}
                            onClick={() => seekToSubtitle(sub.offset)}
                            className={`p-3 rounded-lg cursor-pointer transition-all ${
                              activeSubIndex === i
                                ? 'bg-blue-600/30 border border-blue-500'
                                : 'bg-slate-800/50 border border-slate-700 hover:bg-slate-700/50'
                            }`}
                          >
                            <p className="text-xs text-blue-400 font-mono mb-1">
                              {formatTime(sub.offset)}
                            </p>
                            <p className="text-slate-200 text-sm leading-relaxed">{sub.text}</p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
