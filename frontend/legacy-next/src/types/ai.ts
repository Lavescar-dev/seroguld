export interface AIModelOption {
  value: string;
  label: string;
  note: string;
}

export interface AISettings {
  openai_api_key_set: boolean;
  openai_api_key_masked?: string | null;
  openai_base_url: string;
  openai_model: string;
  openai_timeout_seconds: number;
  model_options: AIModelOption[];
}
