# DocMind

Document Ingestion and Retrieval-Augmented Generation (RAG) Backend built with NestJS, PostgreSQL (`pgvector`), Redis (`BullMQ`), and OpenAI.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [System Design](#system-design)
- [Database Schema](#database-schema)
- [Ingestion Pipeline](#ingestion-pipeline)
- [API Reference](#api-reference)
- [Environment Configuration](#environment-configuration)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)

---

## Overview

DocMind is a backend service designed for asynchronous document ingestion, chunking, embedding generation, and vector-based semantic retrieval.

When a document is submitted:
1. It is stored with a `PENDING` state and queued for background processing.
2. A worker chunks the text using boundary-aware splitting (paragraphs, sentences) to preserve context across splits.
3. Chunks are embedded in batches via OpenAI's embedding API.
4. Chunks and their 1536-dimensional vector embeddings are stored in PostgreSQL using the `pgvector` extension.
5. The document status updates across lifecycle states (`PENDING` -> `CHUNKING` -> `EMBEDDING` -> `READY` or `FAILED`).

---

## Architecture

```mermaid
graph TB
    subgraph "Clients"
        API_CLIENT[HTTP Client / API Consumer]
    end

    subgraph "API Layer"
        CONTROLLER[Documents Controller]
        VALIDATION[DTO Validation Pipeline]
        SWAGGER[Swagger UI / OpenAPI]
    end

    subgraph "Application Layer"
        DOC_SVC[Documents Service]
        EMBED_SVC[Embeddings Service]
        CHUNK_UTIL[Chunking Utility]
    end

    subgraph "Job Processing"
        BULLMQ[BullMQ Ingestion Queue]
        WORKER[Ingestion Processor]
    end

    subgraph "Persistence"
        PG[(PostgreSQL 16 + pgvector)]
        REDIS[(Redis 7)]
    end

    subgraph "External Services"
        OPENAI[OpenAI Embeddings API]
    end

    API_CLIENT --> CONTROLLER
    CONTROLLER --> VALIDATION
    CONTROLLER --> DOC_SVC
    DOC_SVC -->|save document & query state| PG
    DOC_SVC -->|enqueue job| BULLMQ
    BULLMQ --> REDIS
    BULLMQ --> WORKER
    WORKER --> CHUNK_UTIL
    WORKER --> EMBED_SVC
    EMBED_SVC --> OPENAI
    WORKER -->|batch insert chunks & vectors| PG
    WORKER -->|update status| PG
```

---

## Technology Stack

| Layer | Component | Details |
|:---|:---|:---|
| **Runtime** | Node.js | v20+ LTS |
| **Framework** | NestJS | v11 modular backend framework |
| **Language** | TypeScript | v5.7 with strict type checking |
| **Database** | PostgreSQL 16 | Relational storage for documents and chunks |
| **Vector Engine** | `pgvector` | Native vector data type and `ivfflat` similarity indexing |
| **ORM** | TypeORM | Entity mappings and relational queries; raw SQL for vector operations |
| **Job Queue** | BullMQ + Redis 7 | Distributed queue for background document processing |
| **Embeddings** | OpenAI API | `text-embedding-3-small` (1536 dimensions) |
| **Validation** | `class-validator` / `class-transformer` | Request payload validation and transformation |
| **API Docs** | Swagger / OpenAPI | Auto-generated interactive API documentation |

---

## System Design

### Asynchronous Ingestion & State Tracking

Document processing (tokenization, chunking, external API embedding calls, vector persistence) is decoupled from HTTP request lifecycles. HTTP endpoints return immediately with a job identifier and initial status, preventing client timeouts on large documents.

Document lifecycle states:
- `PENDING`: Document record created, ingestion job enqueued.
- `CHUNKING`: Text is being split into overlapping segments.
- `EMBEDDING`: Text chunks are being sent to OpenAI for vector generation.
- `READY`: All chunks and embeddings are persisted; document is available for retrieval.
- `FAILED`: Processing failed; error details stored in `failureReason`.

### Boundary-Aware Chunking

Text splitting prioritizes natural content boundaries:
1. Double newlines (paragraphs)
2. Single newlines / punctuation (sentences)
3. Fallback to character counts if no boundary exists within the chunk threshold

Overlap between sequential chunks prevents loss of semantic context at boundary cutoffs.

### Vector Storage

Embeddings are stored directly in PostgreSQL using a `vector(1536)` column on the `chunks` table. This removes the operational complexity of maintaining a separate vector database while enabling transactional consistency between document metadata and chunk vectors.

---

## Database Schema

```mermaid
erDiagram
    Document ||--o{ Chunk : "contains"

    Document {
        uuid id PK
        string title
        text sourceContent
        enum status "PENDING | CHUNKING | EMBEDDING | READY | FAILED"
        text failureReason
        datetime createdAt
    }

    Chunk {
        uuid id PK
        uuid documentId FK
        int chunkIndex
        text content
        vector embedding "vector(1536)"
        datetime createdAt
    }
```

---

## Ingestion Pipeline

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant API as Documents Controller
    participant Service as Documents Service
    participant Queue as BullMQ Queue
    participant Worker as Ingestion Processor
    participant Chunker as Chunking Utility
    participant Embedder as Embeddings Service
    participant OpenAI as OpenAI API
    participant DB as PostgreSQL (pgvector)

    Client->>API: POST /documents (title, content)
    API->>Service: submitDocument(dto)
    Service->>DB: INSERT Document (status: PENDING)
    Service->>Queue: add("ingest-doc", { documentId })
    Service-->>API: Document entity
    API-->>Client: 201 Created { id, status: PENDING }

    Queue->>Worker: process(job)
    Worker->>DB: UPDATE Document SET status = 'CHUNKING'
    Worker->>Chunker: chunkText(sourceContent, options)
    Chunker-->>Worker: string[] chunks

    Worker->>DB: UPDATE Document SET status = 'EMBEDDING'
    loop Batches of 20 chunks
        Worker->>Embedder: embedBatch(chunkBatch)
        Embedder->>OpenAI: POST /v1/embeddings
        OpenAI-->>Embedder: number[][] vectors
        Worker->>DB: INSERT INTO chunks (document_id, chunk_index, content, embedding)
    end

    Worker->>DB: UPDATE Document SET status = 'READY'
    Client->>API: GET /documents/:id
    API-->>Client: 200 OK { id, status: READY }
```

---

## API Reference

Interactive Swagger documentation is available at `/api/docs` when the server is running.

### Endpoints

| Method | Route | Description |
|:---|:---|:---|
| `POST` | `/documents` | Ingest a new document (queues async ingestion) |
| `GET` | `/documents` | List all documents ordered by creation date |
| `GET` | `/documents/:id` | Get document metadata and ingestion status |

### Ingest Document

**Request**
```http
POST /documents HTTP/1.1
Content-Type: application/json

{
  "title": "Architecture Overview",
  "content": "DocMind is an asynchronous RAG backend built on NestJS and PostgreSQL..."
}
```

**Response (`201 Created`)**
```json
{
  "message": "Document queued for ingestion",
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "status": "PENDING"
}
```

### Get Document Status

**Request**
```http
GET /documents/c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b HTTP/1.1
```

**Response (`200 OK`)**
```json
{
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "title": "Architecture Overview",
  "status": "READY",
  "failureReason": null,
  "createdAt": "2026-09-02T10:00:00.000Z"
}
```

---

## Environment Configuration

Configure the application by creating a `.env` file in the root directory:

| Variable | Type | Default | Description |
|:---|:---|:---|:---|
| `PORT` | number | `3000` | HTTP server port |
| `DATABASE_URL` | string | `postgresql://docmind:docmind@localhost:5432/docmind` | PostgreSQL connection URL |
| `REDIS_HOST` | string | `localhost` | Redis server hostname |
| `REDIS_PORT` | number | `6379` | Redis server port |
| `OPENAI_API_KEY` | string | — | OpenAI API key (required for embeddings) |
| `EMBEDDING_MODEL` | string | `text-embedding-3-small` | OpenAI embedding model name |
| `EMBEDDING_DIMENSIONS` | number | `1536` | Embedding vector dimensionality |
| `CHUNK_SIZE_CHARS` | number | `1200` | Target size per text chunk in characters |
| `CHUNK_OVERLAP_CHARS` | number | `200` | Character overlap between consecutive chunks |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- OpenAI API Key

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/mo74x/Docmind.git
cd Docmind
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Set your `OPENAI_API_KEY` in `.env`.

### 3. Start Infrastructure

Start PostgreSQL with `pgvector` and Redis via Docker Compose:

```bash
docker-compose up -d
```

### 4. Run Application

```bash
# Development mode
npm run start:dev

# Production build
npm run build
npm run start:prod
```

API server will be running at `http://localhost:3000`.  
Swagger documentation is accessible at `http://localhost:3000/api/docs`.

---

## Project Structure

```text
docmind/
├── docker-compose.yml           # Postgres (pgvector) and Redis services
├── .env.example                 # Environment variables template
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts                  # Application bootstrap and Swagger configuration
│   ├── app.module.ts            # Root module (TypeORM, BullMQ, Config)
│   ├── config/
│   │   └── configuration.ts     # Configuration schema and defaults
│   ├── migrations/
│   │   └── run-pgvector.ts      # pgvector extension and column initialization
│   ├── documents/
│   │   ├── document.entity.ts   # Document model and status enum
│   │   ├── chunk.entity.ts      # Chunk model with vector column
│   │   ├── documents.controller.ts # Document HTTP endpoints
│   │   ├── documents.service.ts    # Document business logic and queue dispatcher
│   │   ├── documents.module.ts
│   │   └── dto/
│   │       └── ingest-document.dto.ts
│   ├── ingestion/
│   │   ├── ingestion.processor.ts  # BullMQ worker: chunking -> batch embedding -> insert
│   │   ├── chunking.util.ts        # Boundary-aware text chunking utility
│   │   └── ingestion.module.ts
│   └── embeddings/
│       ├── embeddings.service.ts   # OpenAI batch embeddings wrapper
│       └── embeddings.module.ts
```