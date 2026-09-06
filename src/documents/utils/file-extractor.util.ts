/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

/**
 * Derives a clean document title from the uploaded filename.
 */
export function sanitizeTitleFromFilename(originalname?: string): string {
  if (!originalname) return 'Untitled Document';
  const nameWithoutExt = path.parse(originalname).name;
  const trimmed = nameWithoutExt.trim();
  return trimmed || 'Untitled Document';
}

/**
 * Extracts and sanitizes plaintext from an uploaded PDF, DOCX, or TXT file.
 */
export async function extractTextFromFile(
  file: UploadedFileLike,
): Promise<string> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('Uploaded file is empty');
  }

  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  let rawText = '';

  // PDF
  if (mime === 'application/pdf' || ext === '.pdf') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse');
      const pdfData = await pdfParse(file.buffer);
      rawText = pdfData.text || '';
    } catch (err: any) {
      throw new BadRequestException(
        `Failed to parse PDF file: ${err.message || 'Corrupted or unreadable PDF'}`,
      );
    }
  }
  // DOCX
  else if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword' ||
    ext === '.docx'
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require('mammoth');
      const docxData = await mammoth.extractRawText({ buffer: file.buffer });
      rawText = docxData.value || '';
    } catch (err: any) {
      throw new BadRequestException(
        `Failed to parse DOCX file: ${err.message || 'Corrupted or unreadable DOCX'}`,
      );
    }
  }
  // TXT / plaintext
  else if (
    mime.startsWith('text/') ||
    mime === 'application/octet-stream' ||
    ext === '.txt'
  ) {
    if (ext !== '.txt' && !mime.startsWith('text/')) {
      throw new BadRequestException(
        'Unsupported file format. Supported formats are .pdf, .docx, and .txt',
      );
    }
    rawText = file.buffer.toString('utf-8');
  } else {
    throw new BadRequestException(
      'Unsupported file format. Supported formats are .pdf, .docx, and .txt',
    );
  }

  // Clean whitespace: unify line endings, collapse excess empty lines, and trim
  const cleaned = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!cleaned) {
    throw new BadRequestException('Uploaded file contains no readable text');
  }

  return cleaned;
}
