export interface Session {
  id: string;
  host_name: string;
  host_whatsapp?: string;
  game_name: string;
  player_count_preference: string;
  dates_available: string[];
  game_source: string;
  location?: string;
  min_players: number;
  max_players: number;
  rules?: string;
  created_at: string;
  max_available_count?: number;
  best_date?: string;
  availability_counts?: Record<string, number>;
  booking_code?: string;
  host_uid?: string;
  purpose?: string;
  content?: string;
}

export interface Response {
  id: string;
  session_id: string;
  participant_uid: string;
  player_name: string;
  dates_available: string[];
  created_at: string;
}

export interface SessionWithResponses extends Session {
  responses: Response[];
}
