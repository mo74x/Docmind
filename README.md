<p align="center">
  <b>RAG-Based Document Question Answering Backend</b>
  <br/>
  Built with NestJS | PostgreSQL 16 + pgvector | Redis 7 | BullMQ | OpenAI
</p>

---

## Table of Contents

- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Core Features](#core-features)
- [Database Domain Model](#database-domain-model)
- [Ingestion Pipeline](#ingestion-pipeline)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Local Development and Setup](#local-development-and-setup)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)
- [Design Decisions](#design-decisions)

---

## Overview

**DocMind** is a Retrieval-Augmented Generation (RAG) backend that ingests
documents, splits and embeds them, and stores the resulting vectors in
PostgreSQL via the `pgvector` extension. Once ingested, documents become
queryable: a question is embedded with the same model, matched against
stored chunks by cosine similarity, and (from Phase 2 onward) used to
build a grounded, source-cited answer via an LLM.

The system is built around the same architectural patterns already
proven in [Hwala](https://github.com/mo74x/Hwala) and FleetPulse —
BullMQ-driven async processing, PostgreSQL as the single source of
truth, and status-tracked long-running operations that a client can
poll rather than block on.

---

## System Architecture

```mermaid
graph TB
    subgraph "Client"
        API_CLIENT[API Consumer]
    end

    subgraph "API Layer"
        VALIDATION[DTO Validation Pipeline]
        SWAGGER[Swagger / OpenAPI Docs]
    end

    subgraph "Application Layer"
        DOC_MOD[Documents Module]
        QUERY_MOD[Query Module - Phase 2]
    end

    subgraph "Background Processing"
        BULLMQ[BullMQ Ingestion Queue]
        WORKER[Ingestion Processor]
        CHUNK[Chunking Utility]
        EMBED[Embeddings Service]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL 16 + pgvector<br/>Documents and Chunks)]
        REDIS[(Redis 7<br/>BullMQ Job Store)]
    end

    subgraph "External"
        OPENAI[OpenAI Embeddings + Chat API]
    end

    API_CLIENT --> VALIDATION --> DOC_MOD
    DOC_MOD -->|enqueue| BULLMQ
    BULLMQ --> REDIS
    BULLMQ --> WORKER
    WORKER --> CHUNK
    WORKER --> EMBED
    EMBED --> OPENAI
    WORKER -->|store chunks + vectors| PG
    DOC_MOD -->|read status| PG
    QUERY_MOD -.->|Phase 2| PG
    QUERY_MOD -.->|Phase 2| OPENAI
```

---

## Technology Stack

| Layer | Technology | Description |
|:---|:---|:---|
| **Runtime** | Node.js 20+ | LTS JavaScript runtime |
| **Framework** | NestJS 10 | TypeScript framework with modular architecture and dependency injection |
| **Language** | TypeScript 5.5 | Strict type-safe development |
| **Database** | PostgreSQL 16 | Stores documents, chunks, and metadata |
| **Vector Search** | pgvector | Postgres extension for vector storage and cosine-similarity search (`ivfflat` index) |
| **ORM** | TypeORM 0.3 | Entity mapping for documents/chunks; raw parameterized queries for vector operations (no query-builder support for `<->`) |
| **Queue** | BullMQ + Redis 7 | Async ingestion pipeline: chunking, batched embedding, storage |
| **Embeddings** | OpenAI `text-embedding-3-small` | 1536-dimension embeddings, configurable via env |
| **Generation** | OpenAI `gpt-4o-mini` | Grounded answer generation (Phase 3) |
| **Validation** | class-validator / class-transformer | Request DTO validation |
| **API Documentation** | Swagger / OpenAPI | Interactive docs at `/api/docs` |
| **Containerization** | Docker Compose | Local Postgres (pgvector image) + Redis |

---

## Core Features

### Document Ingestion (Phase 1 — built)

A document is submitted as raw text via `POST /documents`, saved with
`PENDING` status, and enqueued as a BullMQ job. A worker then:

1. Splits the text into overlapping chunks, preferring paragraph or
   sentence boundaries over hard character cuts
2. Embeds chunks in batches (not one API call per chunk) to reduce
   request count and stay within rate limits
3. Stores each chunk alongside its vector in PostgreSQL via a raw
   parameterized query, since TypeORM's query builder has no first-class
   support for the pgvector column type or its `<->` distance operator
4. Updates the document's status through `chunking → embedding → ready`,
   or `failed` with a captured error reason

BullMQ retries failed jobs three times with exponential backoff before
marking the document `FAILED` — the same resilience pattern used for
Hwala's webhook dispatcher.

### Deterministic Chunking

Chunking prefers paragraph breaks, then sentence breaks, and only falls
back to a hard character cut if neither boundary is found near the
target chunk size. Overlap between consecutive chunks preserves context
that would otherwise be lost at a chunk boundary — a fact split exactly
at the cut point is unretrievable no matter how good the embedding
model is.

### Vector Storage via pgvector

Rather than introducing a separate vector database, embeddings are
stored as a native `vector(1536)` column on the `chunks` table, indexed
with `ivfflat` for approximate cosine-similarity search. This keeps
the system on infrastructure already in use elsewhere (Hwala,
FleetPulse) instead of adding a new operational dependency.

### Status Polling

Ingestion is asynchronous by design — large documents can take longer
to chunk and embed than a single HTTP request should block for. Clients
poll `GET /documents/:id` to observe status transitions and pick up the
document as soon as it's `READY`.

---

## Database Domain Model

```mermaid
erDiagram
    Document ||--o{ Chunk : "split into"

    Document {
        uuid id PK
        string title
        text sourceContent
        string sourceUrl
        enum status "PENDING | CHUNKING | EMBEDDING | READY | FAILED"
        string failureReason
        datetime createdAt
    }

    Chunk {
        uuid id PK
        uuid documentId FK
        int chunkIndex
        text content
        vector embedding "vector(1536), pgvector"
        datetime createdAt
    }
```

---

## Ingestion Pipeline

```mermaid
sequenceDiagram
    participant Client
    participant API as Documents API
    participant Queue as BullMQ
    participant Worker as Ingestion Processor
    participant Chunker as Chunking Utility
    participant Embedder as Embeddings Service
    participant OpenAI
    participant DB as PostgreSQL

    Client->>API: POST /documents (title, content)
    API->>DB: INSERT document (status=PENDING)
    API->>Queue: enqueue ingest job
    API-->>Client: 201 Created (id, status)

    Queue->>Worker: process job
    Worker->>DB: UPDATE status=CHUNKING
    Worker->>Chunker: chunkText(content)
    Chunker-->>Worker: overlapping passages

    Worker->>DB: UPDATE status=EMBEDDING
    loop batches of 20 chunks
        Worker->>Embedder: embedBatch(texts)
        Embedder->>OpenAI: POST /embeddings
        OpenAI-->>Embedder: vectors
        Worker->>DB: INSERT chunk + vector (raw query)
    end

    Worker->>DB: UPDATE status=READY
    Client->>API: GET /documents/:id (polling)
    API-->>Client: status=READY
```

---

## API Reference

Interactive Swagger documentation is available at
`http://localhost:3000/api/docs`.

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/documents` | Submit a document (title + raw text) for ingestion. Returns immediately with `PENDING` status. |
| `GET` | `/documents` | List all submitted documents, newest first. |
| `GET` | `/documents/:id` | Fetch a single document's current status and metadata. Poll this until `status: "ready"`. |

**Example request:**

```bash
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hwala Core README",
    "content": "<paste document text here>"
  }'
```

**Example response:**

```json
{
  "id": "a3f1c9e2-...",
  "status": "pending",
  "message": "Document queued for ingestion"
}
```

---

## Environment Variables

| Variable | Default | Required | Description |
|:---|:---|:---|:---|
| `DATABASE_URL` | `postgresql://docmind:docmind@localhost:5432/docmind` | Yes | PostgreSQL connection string |
| `REDIS_HOST` | `localhost` | Yes | Redis server hostname |
| `REDIS_PORT` | `6379` | Yes | Redis server port |
| `OPENAI_API_KEY` | — | Yes | API key for embeddings and generation |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | No | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | `1536` | No | Must match the model's output dimension and the `vector(N)` column size |
| `CHAT_MODEL` | `gpt-4o-mini` | No | Model used for answer generation (Phase 3) |
| `CHUNK_SIZE_CHARS` | `1200` | No | Target chunk size in characters |
| `CHUNK_OVERLAP_CHARS` | `200` | No | Overlap between consecutive chunks |
| `PORT` | `3000` | No | HTTP application listening port |

---

## Local Development and Setup

### Prerequisites

- Node.js v20 or later
- Docker and Docker Compose
- An OpenAI API key

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables and add your OpenAI key
cp .env.example .env

# Start PostgreSQL (pgvector image) and Redis
docker-compose up -d

# Start the app — migrations (including the pgvector extension
# and vector column) run automatically on boot
npm run start:dev
```

The API is now available at `http://localhost:3000`, with Swagger docs
at `http://localhost:3000/api/docs`.

### Verifying ingestion end-to-end

```bash
# Submit a document
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -d '{"title": "Test doc", "content": "Some text to ingest and embed."}'

# Poll until status is "ready"
curl http://localhost:3000/documents/<id>
```

---

## Project Structure

```
docmind/
├── docker-compose.yml           # Local Postgres (pgvector) + Redis
├── .env.example
├── package.json
├── tsconfig.json
├── nest-cli.json
├── README.md
├── src/
│   ├── main.ts                  # Application bootstrap, Swagger setup
│   ├── app.module.ts            # Root module, TypeORM + BullMQ config
│   ├── config/
│   │   └── configuration.ts     # Centralized env-driven config
│   ├── migrations/
│   │   └── 1700000000000-AddPgvector.ts   # Enables pgvector, adds vector column + ivfflat index
│   ├── documents/
│   │   ├── document.entity.ts   # Document entity + status enum
│   │   ├── chunk.entity.ts      # Chunk entity (vector column)
│   │   ├── documents.module.ts
│   │   ├── documents.service.ts # Submit/query documents, enqueue ingestion
│   │   ├── documents.controller.ts
│   │   └── dto/
│   │       └── ingest-document.dto.ts
│   ├── ingestion/
│   │   ├── ingestion.module.ts
│   │   ├── ingestion.processor.ts  # BullMQ worker: chunk -> embed -> store
│   │   └── chunking.util.ts        # Boundary-aware text chunking
│   └── embeddings/
│       ├── embeddings.module.ts
│       └── embeddings.service.ts   # Batched OpenAI embedding calls
```