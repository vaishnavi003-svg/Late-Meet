// Shared Configuration Constants for Late Meet

// AI Model Names
export const DEFAULT_CHAT_MODEL = "gpt-4o-mini";
export const ELEVENLABS_STT_MODEL = "scribe_v2";
export const WHISPER_MODEL = "whisper-1";

// AI Processing Limits
export const MAX_PROMPT_LENGTH = 2000;
export const TRANSCRIPT_WINDOW_SIZE = 25;
export const SUMMARIZATION_MAX_TOKENS = 1200;
export const JOINER_MESSAGE_MAX_TOKENS = 120;

// Audio Pipeline
export const MAX_PENDING_AUDIO_CHUNKS = 8;
export const VAD_SAMPLE_MS = 250;
export const WAVEFORM_INTERVAL_MS = 50;
export const WAVEFORM_BUCKETS = 32;
export const WAVEFORM_GAIN = 6;
export const SILENCE_FLUSH_MS = 1500;
export const MAX_BUFFER_MS = 25000;

// Meeting Behavior
export const MIN_MEETING_DURATION_FOR_WELCOME = 10;
export const BROADCAST_THROTTLE_MS = 500;
