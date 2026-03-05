import api from './api';

export interface AssistantTrainingPayload {
  topic: string;
  context: string;
  updatedAt?: string | null;
}

export interface GenerateScriptPayload {
  leadName: string;
  occupation: string;
  age: string;
  education: string;
  goals: string;
  notes: string;
  trainingTopic: string;
  trainingContext: string;
  searchWeb: boolean;
}

export interface GenerateScriptResponse {
  script: string;
  followUpQuestions: string[];
  webInsights: string[];
  trainingTopic: string;
  trainingContext: string;
}

export const assistantService = {
  async getTraining() {
    const response = await api.get<AssistantTrainingPayload>('/assistant/training');
    return response.data;
  },
  async saveTraining(payload: AssistantTrainingPayload) {
    const response = await api.post<AssistantTrainingPayload>('/assistant/training', payload);
    return response.data;
  },
  async extractName(transcript: string) {
    const response = await api.post<{ extractedName: string | null }>('/assistant/extract-name', { transcript });
    return response.data;
  },
  async generateScript(payload: GenerateScriptPayload) {
    const response = await api.post<GenerateScriptResponse>('/assistant/generate-script', payload);
    return response.data;
  },
};
