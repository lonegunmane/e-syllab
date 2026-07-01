import { GoogleGenAI, Type } from "@google/genai";

// API key is obtained exclusively from environment variables for local development
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const geminiService = {
  async getLearningAssistantResponse(query: string, context: string) {
    // Check connectivity before calling API
    if (!navigator.onLine) {
      return "I'm currently in offline mode. Please reconnect to the internet to use the AI Assistant.";
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Context: You are an educational AI tutor for a secondary school student. 
        Learning Materials Context: ${context}
        Student Query: ${query}`,
        config: {
          temperature: 0.7,
          maxOutputTokens: 500,
          thinkingConfig: { thinkingBudget: 100 },
        }
      });
      return response.text;
    } catch (error) {
      console.error("Gemini Error:", error);
      return "I'm sorry, I'm having trouble connecting to my knowledge base right now.";
    }
  },

  async analyzeClassPerformance(results: any[]) {
    if (!navigator.onLine) return null;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Analyze these student results and provide a 3-point summary of trends and areas for improvement: ${JSON.stringify(results)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.ARRAY, items: { type: Type.STRING } },
              riskLevel: { type: Type.STRING, description: "Low, Medium, or High" }
            }
          }
        }
      });
      return response.text ? JSON.parse(response.text.trim()) : null;
    } catch (error) {
      console.error("Gemini Analysis Error:", error);
      return null;
    }
  }
};