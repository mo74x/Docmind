import { chunkText } from './chunking.util';

describe('chunkText', () => {
  describe('Word boundary preservation', () => {
    it('should never split words across chunk boundaries', () => {
      const text =
        'The quick brown fox jumps over the lazy dog and runs through the deep green forest';
      // maxChunkSize = 25, overlap = 8
      const chunks = chunkText(text, 25, 8);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(25);
        const chunkWords = chunk.split(' ');
        for (const word of chunkWords) {
          expect(word.length).toBeGreaterThan(0);
          // Verify each word is an intact word from the original sentence
          expect(text.split(/\s+/)).toContain(word);
        }
      }
    });

    it('should preserve entire words even with small chunk sizes', () => {
      const text = 'Internationalization localization accessibility';
      // maxChunkSize = 22, overlap = 5
      const chunks = chunkText(text, 22, 5);

      expect(chunks).toEqual([
        'Internationalization',
        'localization',
        'accessibility',
      ]);
    });
  });

  describe('Character overlap verification', () => {
    it('should carry over trailing words as overlap into the next chunk', () => {
      const text = 'one two three four five six seven eight nine ten';
      const maxChunkSize = 20;
      const overlap = 8;
      const chunks = chunkText(text, maxChunkSize, overlap);

      expect(chunks.length).toBeGreaterThan(1);
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentWords = chunks[i].split(' ');
        const nextWords = chunks[i + 1].split(' ');

        const nextChunkOverlappingWords: string[] = [];

        for (const word of nextWords) {
          if (currentWords.includes(word)) {
            nextChunkOverlappingWords.push(word);
          } else {
            break;
          }
        }

        if (nextChunkOverlappingWords.length > 0) {
          const overlapStr = nextChunkOverlappingWords.join(' ');
          expect(overlapStr.length).toBeLessThanOrEqual(overlap);
          expect(chunks[i].endsWith(overlapStr)).toBe(true);
        }
      }
    });

    it('should not duplicate words when overlap is 0', () => {
      const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
      const chunks = chunkText(text, 20, 0);

      const allWordsInChunks = chunks.flatMap((c) => c.split(' '));
      const originalWords = text.split(' ');
      expect(allWordsInChunks).toEqual(originalWords);
    });

    it('should ensure overlap does not exceed the specified overlap parameter', () => {
      const text =
        'Artificial intelligence is transforming how software systems process information and reason about complex problems.';
      const maxChunkSize = 40;
      const overlap = 15;
      const chunks = chunkText(text, maxChunkSize, overlap);

      for (let i = 0; i < chunks.length - 1; i++) {
        const currentWords = chunks[i].split(' ');
        const nextWords = chunks[i + 1].split(' ');

        let sharedWordCount = 0;
        for (
          let j = 1;
          j <= Math.min(currentWords.length, nextWords.length);
          j++
        ) {
          const currentEnd = currentWords.slice(-j).join(' ');
          const nextStart = nextWords.slice(0, j).join(' ');
          if (currentEnd === nextStart) {
            sharedWordCount = j;
          }
        }

        if (sharedWordCount > 0) {
          const sharedText = currentWords.slice(-sharedWordCount).join(' ');
          expect(sharedText.length).toBeLessThanOrEqual(overlap);
        }
      }
    });
  });

  describe('Edge cases', () => {
    it('should return an empty array for empty string', () => {
      expect(chunkText('')).toEqual([]);
    });

    it('should return an empty array for whitespace-only text', () => {
      expect(chunkText('   ')).toEqual([]);
      expect(chunkText('\n\t  \r\n')).toEqual([]);
    });

    it('should return an empty array for null or undefined input', () => {
      expect(chunkText(null as unknown as string)).toEqual([]);
      expect(chunkText(undefined as unknown as string)).toEqual([]);
    });

    it('should return a single chunk if text is smaller than maxChunkSize', () => {
      const text = 'Short text that fits in one chunk.';
      const chunks = chunkText(text, 100, 20);
      expect(chunks).toEqual([text]);
    });

    it('should return a single chunk if text exactly equals maxChunkSize', () => {
      const text = 'Exactly twenty chars';
      expect(text.length).toBe(20);
      const chunks = chunkText(text, 20, 5);
      expect(chunks).toEqual([text]);
    });

    it('should handle consecutive irregular spaces and tabs properly without empty words', () => {
      const text = 'word1   \t   word2  \n\n  word3    word4';
      const chunks = chunkText(text, 50, 10);
      expect(chunks).toEqual(['word1 word2 word3 word4']);
    });

    it('should split large paragraphs into multiple chunks respecting maxChunkSize', () => {
      const paragraph =
        'DocMind is an advanced retrieval augmented generation architecture designed to ingest ' +
        'unstructured enterprise documents, generate vector embeddings, and perform fast cosine similarity ' +
        'queries against PostgreSQL with pgvector. The pipeline leverages asynchronous queue workers ' +
        'to guarantee zero latency blocking on document upload, while exposing standard REST APIs.';

      const maxChunkSize = 100;
      const overlap = 25;
      const chunks = chunkText(paragraph, maxChunkSize, overlap);

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(maxChunkSize);
        expect(chunk.trim()).toBe(chunk);
      }
    });

    it('should handle a single word longer than maxChunkSize without entering an infinite loop', () => {
      const longWord =
        'SupercalifragilisticexpialidociousAndEvenLongerThanMaxChunkSize';
      const chunks = chunkText(longWord, 20, 5);
      expect(chunks).toEqual([longWord]);
    });

    it('should use default parameters (maxChunkSize = 1200, overlap = 200) when not provided', () => {
      const text =
        'A'.repeat(500) + ' ' + 'B'.repeat(500) + ' ' + 'C'.repeat(500);
      const chunks = chunkText(text);

      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBeLessThanOrEqual(1200);
      expect(chunks[1].length).toBeLessThanOrEqual(1200);
    });
  });
});
