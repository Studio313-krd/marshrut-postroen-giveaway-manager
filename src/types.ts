export type Winner = {
  account: string;
  participantIndex: number;
  place: number;
  kind: 'main' | 'reserve';
};

export type Draw = {
  id: string;
  winners: Winner[];
  animationSeed: number;
  createdAt: string;
  sourceHash: string;
  participantsCount: number;
  duration: number;
};

export type AppState = {
  settings: { main: number; reserve: number };
  participants: string[];
  sourceHash: string;
  sourceFile: string;
  isInstagram: boolean;
  inputKind: 'excel' | 'text';
  rows?: number;
  duplicates?: number;
  draw: Draw | null;
  encoderReady: boolean;
  videoUrl: string | null;
  renderVersion: number;
};
