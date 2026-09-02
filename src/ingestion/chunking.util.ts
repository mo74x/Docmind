// Splits text into chunks of a maximum size, with a specified overlap.
// Uses word boundaries to avoid cutting words in half.

export function chunkText(
  text: string,
  maxChunkSize: number = 1200,
  overlap: number = 200,
): string[] {
  if (!text || text.trim() === '') return [];

  // Split by whitespace to respect word boundaries
  const words = text.split(/\s+/);
  const chunks: string[] = [];

  let currentChunkWords: string[] = [];
  let currentChunkLength = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // +1 for the space character
    const wordLength = word.length + (currentChunkLength > 0 ? 1 : 0);

    if (
      currentChunkLength + wordLength > maxChunkSize &&
      currentChunkWords.length > 0
    ) {
      // Chunk is full, push it
      chunks.push(currentChunkWords.join(' '));

      // Calculate overlap for the next chunk
      let overlapLength = 0;
      const overlapWords: string[] = [];

      // Walk backward through the current chunk to gather the overlap text
      for (let j = currentChunkWords.length - 1; j >= 0; j--) {
        const overlapWord = currentChunkWords[j];
        const overlapWordLen =
          overlapWord.length + (overlapWords.length > 0 ? 1 : 0);

        if (overlapLength + overlapWordLen <= overlap) {
          overlapWords.unshift(overlapWord);
          overlapLength += overlapWordLen;
        } else {
          break;
        }
      }

      currentChunkWords = [...overlapWords, word];
      currentChunkLength =
        overlapLength + word.length + (overlapLength > 0 ? 1 : 0);
    } else {
      currentChunkWords.push(word);
      currentChunkLength += wordLength;
    }
  }

  // Push the final chunk if anything is left
  if (currentChunkWords.length > 0) {
    chunks.push(currentChunkWords.join(' '));
  }

  return chunks;
}
