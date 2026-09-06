import { BadRequestException } from '@nestjs/common';
import {
  extractTextFromFile,
  sanitizeTitleFromFilename,
  UploadedFileLike,
} from './file-extractor.util';

jest.mock('pdf-parse', () => {
  return jest.fn().mockImplementation((buffer: Buffer) => {
    if (buffer.toString() === 'CORRUPT_PDF') {
      throw new Error('Invalid PDF structure');
    }
    if (buffer.toString() === 'EMPTY_PDF') {
      return Promise.resolve({ text: '   \n\n  ' });
    }
    return Promise.resolve({
      text: 'Extracted PDF Text\r\n\r\nPage 2 Content',
    });
  });
});

jest.mock('mammoth', () => ({
  extractRawText: jest
    .fn()
    .mockImplementation(({ buffer }: { buffer: Buffer }) => {
      if (buffer.toString() === 'CORRUPT_DOCX') {
        throw new Error('Invalid DOCX archive');
      }
      if (buffer.toString() === 'EMPTY_DOCX') {
        return Promise.resolve({ value: '   ' });
      }
      return Promise.resolve({
        value: 'Extracted DOCX Text\n\n\n\nParagraph 2 Content',
      });
    }),
}));

describe('file-extractor.util', () => {
  describe('sanitizeTitleFromFilename', () => {
    it('should strip common file extensions and trim', () => {
      expect(sanitizeTitleFromFilename('annual_report.pdf')).toBe(
        'annual_report',
      );
      expect(sanitizeTitleFromFilename('quarterly-summary.docx')).toBe(
        'quarterly-summary',
      );
      expect(sanitizeTitleFromFilename('notes.txt')).toBe('notes');
    });

    it('should fallback to Untitled Document if filename is missing or blank', () => {
      expect(sanitizeTitleFromFilename('')).toBe('Untitled Document');
      expect(sanitizeTitleFromFilename(undefined)).toBe('Untitled Document');
      expect(sanitizeTitleFromFilename('   .pdf')).toBe('Untitled Document');
    });
  });

  describe('extractTextFromFile', () => {
    it('should throw BadRequestException if file or buffer is empty', async () => {
      const emptyFile: UploadedFileLike = {
        originalname: 'empty.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from(''),
        size: 0,
      };

      await expect(extractTextFromFile(emptyFile)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should extract and clean text from a valid .txt file', async () => {
      const txtFile: UploadedFileLike = {
        originalname: 'readme.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('Hello world!\r\n\r\n\r\nSecond line.\r\n'),
        size: 35,
      };

      const result = await extractTextFromFile(txtFile);
      expect(result).toBe('Hello world!\n\nSecond line.');
    });

    it('should extract text from a valid .pdf file', async () => {
      const pdfFile: UploadedFileLike = {
        originalname: 'doc.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('VALID_PDF_BYTES'),
        size: 16,
      };

      const result = await extractTextFromFile(pdfFile);
      expect(result).toBe('Extracted PDF Text\n\nPage 2 Content');
    });

    it('should extract text from a valid .docx file', async () => {
      const docxFile: UploadedFileLike = {
        originalname: 'specs.docx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('VALID_DOCX_BYTES'),
        size: 16,
      };

      const result = await extractTextFromFile(docxFile);
      expect(result).toBe('Extracted DOCX Text\n\nParagraph 2 Content');
    });

    it('should reject unsupported file extensions', async () => {
      const exeFile: UploadedFileLike = {
        originalname: 'virus.exe',
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('SOME_BYTES'),
        size: 10,
      };

      await expect(extractTextFromFile(exeFile)).rejects.toThrow(
        'Unsupported file format',
      );
    });

    it('should handle corrupted PDF parsing errors', async () => {
      const corruptPdf: UploadedFileLike = {
        originalname: 'bad.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('CORRUPT_PDF'),
        size: 11,
      };

      await expect(extractTextFromFile(corruptPdf)).rejects.toThrow(
        /Failed to parse PDF file/,
      );
    });

    it('should handle corrupted DOCX parsing errors', async () => {
      const corruptDocx: UploadedFileLike = {
        originalname: 'bad.docx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('CORRUPT_DOCX'),
        size: 12,
      };

      await expect(extractTextFromFile(corruptDocx)).rejects.toThrow(
        /Failed to parse DOCX file/,
      );
    });

    it('should reject files that contain only whitespace after extraction', async () => {
      const blankPdf: UploadedFileLike = {
        originalname: 'blank.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('EMPTY_PDF'),
        size: 9,
      };

      await expect(extractTextFromFile(blankPdf)).rejects.toThrow(
        'Uploaded file contains no readable text',
      );
    });
  });
});
