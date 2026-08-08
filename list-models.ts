import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

async function main() {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await client.models.list();
  
  for await (const model of response) {
    if (model.name.includes('gemini')) {
      console.log(model.name);
    }
  }
}
main().catch(console.error);
