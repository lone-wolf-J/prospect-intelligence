import { aiRegistry } from "./ai-registry.js";

export interface StructuredExtraction {
  personalInfo: {
    name?: string;
    title?: string;
    company?: string;
    location?: string;
    email?: string;
    phone?: string;
    linkedin?: string;
    twitter?: string;
    github?: string;
    website?: string;
  };
  professional: {
    currentRole?: string;
    company?: string;
    industry?: string;
    experience?: Array<{
      role: string;
      company: string;
      duration?: string;
      description?: string;
    }>;
    education?: Array<{
      institution: string;
      degree?: string;
      field?: string;
      year?: string;
    }>;
    skills?: string[];
  };
  personal: {
    interests?: string[];
    volunteerActivities?: string[];
    publications?: Array<{
      title: string;
      url?: string;
      date?: string;
    }>;
    speaking?: Array<{
      event: string;
      date?: string;
      role?: string;
    }>;
    awards?: Array<{
      title: string;
      date?: string;
    }>;
    volunteerExperience?: Array<{
      organization: string;
      role?: string;
      date?: string;
    }>;
  };
  company: {
    name?: string;
    description?: string;
    industry?: string;
    size?: string;
    location?: string;
    website?: string;
    founded?: string;
    funding?: string;
    products?: string[];
    technologies?: string[];
  };
  events: Array<{
    name: string;
    date?: string;
    role?: string;
    location?: string;
    url?: string;
  }>;
  socialHandles: {
    linkedin?: string;
    twitter?: string;
    github?: string;
    instagram?: string;
    facebook?: string;
    youtube?: string;
    medium?: string;
    mediumProfile?: string;
  };
  timeline: Array<{
    date: string;
    event: string;
    type: 'career' | 'education' | 'event' | 'publication' | 'award' | 'other';
    details: string;
    source?: string;
  }>;
  signals: {
    hiring?: boolean;
    fundraising?: boolean;
    expansion?: boolean;
    productLaunch?: boolean;
    partnership?: boolean;
    acquisition?: boolean;
    leadershipChange?: boolean;
    technologyAdoption?: string[];
  };
  confidence: {
    personal: number;
    professional: number;
    company: number;
    contacts: number;
    overall: number;
  };
}

const EXTRACTION_PROMPT = `You are an expert intelligence analyst. Extract structured information from the provided web content about a person.

CRITICAL RULES:
1. ONLY extract information that is EXPLICITLY stated in the provided content
2. If information is not found, use null/empty - DO NOT INFER OR HALLUCINATE
3. Every extracted field must be directly supported by the provided text
4. For social handles, only include if the URL is explicitly found in the content
4. For timeline events, only include if date and event are explicitly mentioned
5. For contacts, only include if explicitly found with confidence score
6. Mark confidence for each section: HIGH (multiple sources), MEDIUM (single source), LOW (inferred), UNKNOWN (not found)

Return ONLY valid JSON matching this exact schema:

{
  "personalInfo": {
    "name": "string or null",
    "title": "string or null",
    "company": "string or null",
    "location": "string or null",
    "email": "string or null",
    "phone": "string or null",
    "linkedin": "string or null",
    "twitter": "string or null",
    "github": "string or null",
    "website": "string or null"
  },
  "professional": {
    "currentRole": "string or null",
    "company": "string or null",
    "industry": "string or null",
    "experience": [{"role": "string", "company": "string", "duration": "string or null", "description": "string or null"}],
    "education": [{"institution": "string", "degree": "string or null", "field": "string or null", "year": "string or null"}],
    "skills": ["string"]
  },
  "personal": {
    "interests": ["string"],
    "volunteer": ["string"],
    "publications": [{"title": "string", "url": "string or null", "date": "string or null"}],
    "speaking": [{"event": "string", "date": "string or null", "role": "string or null"}],
    "awards": [{"title": "string", "date": "string or null"}],
    "volunteer": [{"organization": "string", "role": "string or null", "date": "string or null"}]
  },
  "company": {
    "name": "string or null",
    "description": "string or null",
    "industry": "string or null",
    "size": "string or null",
    "location": "string or null",
    "website": "string or null",
    "founded": "string or null",
    "funding": "string or null",
    "products": ["string"],
    "technologies": ["string"]
  },
  "events": [{"name": "string", "date": "string or null", "role": "string or null", "location": "string or null", "url": "string or null"}],
  "socialHandles": {
    "linkedin": "string or null",
    "twitter": "string or null",
    "github": "string or null",
    "instagram": "string or null",
    "facebook": "string or null",
    "youtube": "string or null",
    "medium": "string or null",
    "mediumProfile": "string or null"
  },
  "timeline": [{"date": "string", "event": "string", "type": "career|education|event|publication|award|other", "details": "string", "source": "string or null"}],
  "signals": {
    "hiring": false,
    "fundraising": false,
    "expansion": false,
    "productLaunch": false,
    "partnership": false,
    "acquisition": false,
    "leadershipChange": false,
    "technologyAdoption": []
  },
  "confidence": {
    "personal": 0,
    "professional": 0,
    "company": 0,
    "contacts": number,
    "overall": number
  }
}

CONTENT TO ANALYZE:
`;

export async function extractStructuredData(content: string, query: string): Promise<any> {
  const prompt = EXTRACTION_PROMPT + content.slice(0, 8000);

  // Prefer Tinyfish (separate quota) so Groq TPM is preserved for final synthesis
  const tinyfishKey = process.env.TINYFISH_API_KEY;
  if (tinyfishKey) {
    try {
      const nodeFetch = (await import("node-fetch")).default;
      const res: any = await nodeFetch("https://api.tinyfish.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${tinyfishKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "tinyfish", messages: [{ role: "user", content: prompt }], temperature: 0.1, max_tokens: 2500 })
      });
      const data: any = await res.json();
      const text = data.choices?.[0]?.message?.content || data.output || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Tinyfish no JSON");
      const extracted = JSON.parse(jsonMatch[0]) as Record<string, any>;
      return { ...extracted, extractedAt: new Date().toISOString(), sourceLength: content.length, model: 'tinyfish' };
    } catch (error) {
      console.error('[StructuredExtraction] Tinyfish failed, trying registry:', error);
    }
  }

  try {
    const { result } = await aiRegistry.generateJSON(prompt, {
      temperature: 0.1,
      maxTokens: 2500
    });

    // Add metadata
    const extracted = result as Record<string, any>;
    return {
      ...extracted,
      extractedAt: new Date().toISOString(),
      sourceLength: content.length,
      model: 'groq-llm'
    };
  } catch (error) {
    console.error('[StructuredExtraction] Failed:', error);
    return getEmptyExtraction();
  }
}

function getEmptyExtraction() {
  return {
    personalInfo: { name: null, title: null, company: null, location: null, email: null, phone: null, linkedin: null, twitter: null, github: null, website: null },
    professional: { currentRole: null, company: null, industry: null, experience: [], education: [], skills: [] },
    personal: { interests: [], volunteerActivities: [], publications: [], speaking: [], awards: [], volunteerExperience: [] },
    company: { name: null, description: null, industry: null, size: null, location: null, website: null, founded: null, funding: null, products: [], technologies: [] },
    events: [],
    socialHandles: { linkedin: null, twitter: null, github: null, instagram: null, facebook: null, youtube: null, medium: null, mediumProfile: null },
    timeline: [],
    signals: { hiring: false, fundraising: false, expansion: false, productLaunch: false, partnership: false, acquisition: false, leadershipChange: false, technologyAdoption: [] },
    confidence: { personal: 0, professional: 0, company: 0, contacts: 0, overall: 0 }
  };
}

// Enhanced contact extraction with confidence scoring
export function extractEnhancedContacts(content: string, query: string): Array<{
  type: 'email' | 'phone' | 'linkedin' | 'twitter' | 'github' | 'instagram' | 'facebook' | 'youtube' | 'medium';
  value: string;
  confidence: number;
  source: string;
  context?: string;
}> {
  const contacts: Array<{
    type: 'email' | 'phone' | 'linkedin' | 'twitter' | 'github' | 'instagram' | 'facebook' | 'youtube' | 'medium';
    value: string;
    confidence: number;
    source: string;
    context?: string;
  }> = [];
  
  const seen = new Set<string>();
  
  // Email extraction with context
  const emailRegex = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let match;
  while ((match = /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi.exec(content)) !== null) {
    const email = match[1].toLowerCase();
    if (!seen.has(email) && !email.includes('example.com') && !email.includes('test@') && !email.includes('noreply')) {
      // Check context for confidence
      const contextStart = Math.max(0, match.index - 100);
      const contextEnd = Math.min(content.length, match.index + match[0].length + 100);
      const context = content.slice(contextStart, contextEnd);
      
      const nameFirst = query.toLowerCase().split(' ')[0];
      const nearName = context.toLowerCase().includes(nameFirst.toLowerCase());
      
      contacts.push({
        type: 'email',
        value: email,
        confidence: nearName ? 85 : 70,
        source: 'scraped',
        context: context.slice(0, 200)
      });
      seen.add(email.toLowerCase());
    }
  }
  
  // Phone numbers with context
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  let phoneMatch;
  while ((match = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g.exec(content)) !== null) {
    const phone = match[0].trim();
    if (!seen.has(phone)) {
      const contextStart = Math.max(0, match.index - 80);
      const contextEnd = Math.min(content.length, match.index + match[0].length + 80);
      const context = content.slice(contextStart, contextEnd);
      
      // Only include if near contact keywords
      const hasContactContext = /phone|contact|tel|mobile|call|reach/i.test(context);
      
      if (hasContactContext) {
        contacts.push({
          type: 'phone',
          value: phone,
          confidence: 75,
          source: 'scraped',
          context: context.slice(0, 200)
        });
        seen.add(phone);
      }
    }
  }
  
  // Social handles - comprehensive
  const socialPatterns: [RegExp, string][] = [
    [/https?:\/\/(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-\_%\/]+/gi, 'linkedin'],
    [/https?:\/\/(?:www\.)?twitter\.com\/[A-Za-z0-9_]+/gi, 'twitter'],
    [/https?:\/\/(?:www\.)?x\.com\/[A-Za-z0-9_]+/gi, 'twitter'],
    [/https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9\-_]+/gi, 'github'],
    [/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9\._]+/gi, 'instagram'],
    [/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9\.]+/gi, 'facebook'],
    [/https?:\/\/(?:www\.)?medium\.com\/@[A-Za-z0-9\-_]+/gi, 'medium'],
    [/https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@)[A-Za-z0-9\-_]+/gi, 'youtube'],
  ];
  
  for (const [regex, type] of socialPatterns) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const url = match[0];
      if (!seen.has(url)) {
        seen.add(url);
        contacts.push({
          type: type as any,
          value: url,
          confidence: 90,
          source: 'social',
        });
      }
    }
  }
  
  return contacts;
}

// Enhanced deep page extraction with LLM
export async function extractDeepPageContent(url: string, html: string, query: string): Promise<any> {
  // Use Jina AI reader for clean content extraction
  try {
    const jinaUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//, '')}`;
    const response = await fetch(jinaUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProspectIntel/1.0)' }
    });
    const text = await response.text();
    
    if (text.length > 1000 && !text.includes('Just a moment') && !text.includes('challenges.cloudflare')) {
      return {
        url,
        content: text.slice(0, 5000),
        extractedAt: new Date().toISOString(),
        method: 'jina-ai'
      };
    }
  } catch (e) {
    console.log('[DeepExtract] Jina failed for', url, e);
  }
  
  // Fallback to cheerio extraction
  try {
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);
    
    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, aside, .nav, .header, .footer, .sidebar, .ads, .advertisement').remove();
    
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000);
    
    return {
      url,
      content: text,
      extractedAt: new Date().toISOString(),
      method: 'cheerio'
    };
  } catch (e) {
    return { url, content: '', extractedAt: new Date().toISOString(), method: 'failed' };
  }
}