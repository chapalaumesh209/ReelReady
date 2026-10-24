export type PublishPreflight = {
  demo: boolean;
  connected: Record<string, boolean>;
  captions: {
    instagramHashtags: number;
    instagramHashtagLimit: number;
    youtubeTitleCharacters: number;
    xCharacters: number;
  };
  blockers: string[];
  warnings: string[];
  media: { public: boolean; expiresAt: string };
  usage: { uploadsThisMonth: number; xPostsToday: number };
};
