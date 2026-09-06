# DocMind

> **Intelligent Document Ingestion & Retrieval-Augmented Generation (RAG) Backend**

Built with **NestJS**, **PostgreSQL** (`pgvector`), **Redis** (`BullMQ` & Caching), **OpenAI**, **Prometheus**, and **Winston**.

[![NestJS](https://img.shields.io/badge/NestJS-v11-ea2845?logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-v5.7-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20+%20pgvector-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7-dc382d?logo=redis&logoColor=white)](https://redis.io)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai&logoColor=white)](https://openai.com)
[![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-e6522c?logo=prometheus&logoColor=white)](https://prometheus.io)
[![Docker](https://img.shields.io/badge/Docker-Multi--stage%20Build-2496ed?logo=docker&logoColor=white)](https://www.docker.com)
[![CI/CD](https://github.com/mo74x/Docmind/actions/workflows/ci.yml/badge.svg)](https://github.com/mo74x/Docmind/actions/workflows/ci.yml)
[![Unit Tests](https://img.shields.io/badge/Unit%20Tests-69%20passed-brightgreen?logo=jest&logoColor=white)](https://jestjs.io)
[![E2E Tests](https://img.shields.io/badge/E2E%20Tests-18%20passed-brightgreen?logo=jest&logoColor=white)](https://jestjs.io)
[![License](https://img.shields.io/badge/License-UNLICENSED-lightgrey)]()

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [System Design & Workflows](#system-design--workflows)
  - [1. Multi-Format File Upload & Text Extraction](#1-multi-format-file-upload--text-extraction)
  - [2. Asynchronous Ingestion Pipeline](#2-asynchronous-ingestion-pipeline)
  - [3. Semantic Search & RAG Q&A Pipeline](#3-semantic-search--rag-qa-pipeline)
  - [4. Intelligent Redis Caching](#4-intelligent-redis-caching)
  - [5. Rate Limiting & Protection](#5-rate-limiting--protection)
  - [6. API Key Authentication & Route Security](#6-api-key-authentication--route-security)
  - [7. Production Docker & Container Orchestration](#7-production-docker--container-orchestration)
- [Observability & Monitoring](#observability--monitoring)
  - [Structured Logging (Winston)](#structured-logging-winston)
  - [Prometheus Metrics](#prometheus-metrics)
- [Database Schema & Indexing](#database-schema--indexing)
- [API Reference](#api-reference)
  - [Documents Endpoints](#documents-endpoints)
  - [Query & Retrieval Endpoints](#query--retrieval-endpoints)
  - [Observability Endpoints](#observability-endpoints)
- [Environment Configuration](#environment-configuration)
- [Testing & Quality Assurance](#testing--quality-assurance)
  - [Running Tests](#running-tests)
  - [Test Suite Breakdown](#test-suite-breakdown)
  - [CI/CD Pipeline (GitHub Actions)](#cicd-pipeline-github-actions)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)

---

## Overview

DocMind is a high-performance backend platform for managing knowledge-base documents and executing low-latency **Retrieval-Augmented Generation (RAG)**. It decouples CPU- and network-heavy document processing (chunking, OpenAI embeddings generation, vector indexing) from HTTP request lifecycles using asynchronous queues, and serves semantic search and grounded AI question answering with multi-tier Redis caching and distributed rate limiting.

The platform exposes **Prometheus-compatible metrics** for production monitoring and uses **Winston structured logging** for full operational visibility.

---

## Key Features

| Category | Feature | Description |
|:---|:---|:---|
| **Ingestion** | Multi-Format File Upload | Upload binary documents (`.pdf`, `.docx`, `.txt` up to 10MB) via `POST /documents/upload` with automatic text extraction, title sanitization, and background RAG queueing. |
| **Ingestion** | Asynchronous Pipeline | Ingest large texts without blocking HTTP clients. Track lifecycle states (`PENDING` → `CHUNKING` → `EMBEDDING` → `READY` / `FAILED`) in real-time. |
| **Documents** | Scalable Pagination | TypeORM `findAndCount` pagination supporting `page`, `limit` (1-100), and `order` (`ASC`/`DESC`), with automatic cascade deletion of chunks on document removal. |
| **Chunking** | Context-Preserving | Boundary-aware splitting prioritizes word structures with sliding window overlaps to prevent semantic cutoff. |
| **Vector DB** | Native PostgreSQL | Utilizes PostgreSQL with `pgvector` and an `ivfflat` cosine similarity index for fast vector search without external vector DB overhead. |
| **RAG** | Grounded Q&A | Synthesizes verified answers strictly from top-k matching source chunks using OpenAI `gpt-4o-mini`, complete with inline `[Source N]` citations and anti-hallucination guardrails. |
| **Caching** | Redis Response Cache | SHA-256 normalized query caching delivers instant sub-millisecond responses on repeated or similarly phrased queries (24h TTL). |
| **Security** | API Key Auth & Rate Limiting | Dual-header API key guard (`x-api-key` / `Bearer <token>`) with `@Public()` decorator bypasses, paired with Redis-backed rate limiting via `@nestjs/throttler`. |
| **DevOps** | Multi-Stage Docker | Hardened multi-stage `Dockerfile` (Node 20 Alpine, unprivileged `node` user) with `docker-compose.yml` orchestrating API, PostgreSQL (`pgvector`), and Redis with healthchecks. |
| **Observability** | Prometheus + Winston | Production-grade metrics (`/metrics`) with custom histograms and counters, plus structured JSON logging with timestamps and execution deltas. |
| **Quality** | Unit & E2E Testing | Complete Jest & Supertest suites covering 100% of critical paths with isolated in-memory test mocks. |
| **Docs** | Interactive Swagger | Comprehensive OpenAPI spec with API Key security definitions and multipart file upload schemas at `/api/docs`. |

---

## Architecture

```mermaid
graph TB
    subgraph "Clients"
        CLIENT[HTTP Client / Frontend / Swagger UI]
    end

    subgraph "API & Guard Layer"
        GATEWAY[NestJS Controller]
        AUTH[API Key Guard / @Public Decorator]
        THROTTLE[Redis-Backed Rate Limiter]
        VALIDATION[DTO Validation Pipe]
        MULTER[Multer Multipart File Interceptor]
    end

    subgraph "Ingestion Subsystem"
        EXTRACTOR[File Extractor Utility<br/>PDF, DOCX, TXT]
        DOC_SVC[Documents Service]
        BULLMQ[BullMQ Ingestion Queue]
        WORKER[Ingestion Processor]
        CHUNKER[Boundary-Aware Chunker]
    end

    subgraph "Query & RAG Subsystem"
        QUERY_SVC[Query Service]
        ANSWER_SVC[Answer Service]
        NORMALIZER[Query Normalizer & Hasher]
    end

    subgraph "Observability"
        WINSTON[Winston Structured Logger]
        PROM[Prometheus /metrics Endpoint]
    end

    subgraph "External Providers"
        OPENAI_EMBED[OpenAI Embeddings API<br/>text-embedding-3-small]
        OPENAI_CHAT[OpenAI Chat API<br/>gpt-4o-mini]
    end

    subgraph "Persistence & Infrastructure"
        REDIS[(Redis 7<br/>Queue + Cache + Throttler)]
        PG[(PostgreSQL 16 + pgvector<br/>Documents + Chunks)]
    end

    CLIENT --> THROTTLE
    THROTTLE --> GATEWAY
    GATEWAY --> VALIDATION

    %% Raw Text Ingestion Flow
    VALIDATION -->|POST /documents| DOC_SVC

    %% File Upload Ingestion Flow
    GATEWAY -->|POST /documents/upload| MULTER
    MULTER -->|buffer & mimetype| EXTRACTOR
    EXTRACTOR -->|extracted text & sanitized title| DOC_SVC

    DOC_SVC -->|save PENDING| PG
    DOC_SVC -->|enqueue| BULLMQ
    BULLMQ --> REDIS
    BULLMQ --> WORKER
    WORKER --> CHUNKER
    WORKER -->|batch embed| OPENAI_EMBED
    WORKER -->|batch insert chunks & vectors| PG
    WORKER -->|update status READY| PG

    %% Query & Answer Flow
    VALIDATION -->|POST /query/search| QUERY_SVC
    VALIDATION -->|POST /query/ask| ANSWER_SVC
    ANSWER_SVC --> NORMALIZER
    NORMALIZER -->|check cache| REDIS
    ANSWER_SVC -->|cache miss -> search| QUERY_SVC
    QUERY_SVC -->|embed query| OPENAI_EMBED
    QUERY_SVC -->|vector similarity search| PG
    ANSWER_SVC -->|generate grounded answer| OPENAI_CHAT
    ANSWER_SVC -->|set cache EX 86400s| REDIS

    %% Observability
    ANSWER_SVC -->|record metrics| PROM
    GATEWAY -->|structured logs| WINSTON
    CLIENT -->|GET /metrics| PROM
```

---

## Technology Stack

| Layer | Component | Details |
|:---|:---|:---|
| **Runtime** | Node.js | v20+ LTS |
| **Framework** | NestJS | v11 modular enterprise backend framework |
| **Language** | TypeScript | v5.7 with strict type checking |
| **File Processing** | `pdf-parse` & `mammoth` | Multi-format text extraction from PDF, DOCX, and TXT files |
| **Containerization** | Docker & Docker Compose | Hardened multi-stage build (Node 20 Alpine) & orchestrated multi-container stack |
| **Database** | PostgreSQL 16 | Relational storage for documents and text chunks |
| **Vector Engine** | `pgvector` | Native `vector(1536)` data type with `ivfflat` cosine similarity index |
| **ORM** | TypeORM | Entity mappings and relational transactions; raw SQL for vector operations |
| **Job Queue** | BullMQ + Redis 7 | Distributed job queue for background ingestion pipeline |
| **Caching** | Redis 7 + `ioredis` | Normalized query hash caching (24h TTL) |
| **Rate Limiting** | `@nestjs/throttler` | Distributed Redis-backed throttling storage |
| **AI / LLM** | OpenAI API | `text-embedding-3-small` (1536 dim) & `gpt-4o-mini` |
| **Metrics** | Prometheus + `prom-client` | Custom counters, histograms, and default Node.js runtime metrics via `@willsoto/nestjs-prometheus` |
| **Logging** | Winston + `nest-winston` | Structured JSON logging with timestamps, execution deltas (`ms`), and service metadata |
| **Validation** | `class-validator` / `class-transformer` | Runtime schema validation & DTO transformation |
| **Documentation** | Swagger / OpenAPI | Auto-generated interactive API documentation with multipart file schemas |

---

## System Design & Workflows

### 1. Multi-Format File Upload & Text Extraction

In addition to direct JSON string ingestion, DocMind provides a dedicated multipart file upload endpoint (`POST /documents/upload`) capable of parsing binary documents up to 10MB:

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as Documents Controller
    participant Interceptor as Multer FileInterceptor
    participant Extractor as File Extractor Utility
    participant Service as Documents Service
    participant Queue as BullMQ Queue
    participant DB as PostgreSQL

    Client->>Controller: POST /documents/upload (multipart/form-data: file, title?)
    Controller->>Interceptor: Intercept & enforce 10MB limit
    Interceptor-->>Controller: Multer.File { originalname, buffer, mimetype, size }
    Controller->>Extractor: extractTextFromFile(file)
    
    alt PDF File (.pdf)
        Extractor->>Extractor: pdf-parse(buffer) -> plaintext
    else DOCX File (.docx)
        Extractor->>Extractor: mammoth.extractRawText(buffer) -> plaintext
    else Plain Text (.txt)
        Extractor->>Extractor: buffer.toString('utf-8') -> plaintext
    else Unsupported / Empty
        Extractor-->>Controller: 400 Bad Request
    end

    Extractor->>Extractor: Normalize line endings & collapse whitespace
    Extractor-->>Controller: Clean plaintext
    
    alt Custom title omitted
        Controller->>Extractor: sanitizeTitleFromFilename(file.originalname)
        Extractor-->>Controller: Derived title
    end

    Controller->>Service: submitDocument({ title, content })
    Service->>DB: INSERT Document (status: PENDING)
    Service->>Queue: add("ingest-doc", { documentId })
    Service-->>Controller: Document record
    Controller-->>Client: 201 Created { id, status: PENDING }
```

- **Format Detection**: Inspects MIME type and file extension to route to the appropriate parser:
  - **PDF (`application/pdf`)**: Parsed via `pdf-parse` buffer stream extraction.
  - **DOCX (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)**: Parsed via `mammoth.extractRawText`.
  - **Plain Text (`text/plain`, `.txt`)**: Decoded directly from UTF-8 buffers.
- **Text Normalization**: Unifies Windows (`\r\n`) and Unix (`\n`) newlines, collapses 3+ consecutive linebreaks to double newlines, and trims surrounding whitespace.
- **Title Sanitization**: When an optional `title` is not provided in form data, `sanitizeTitleFromFilename` automatically strips the file extension and whitespace to generate a human-readable title.
- **Fail-Fast Validation**: Empty files, corrupt binary archives, or files yielding zero readable characters immediately throw descriptive `400 Bad Request` exceptions before touching database or queue resources.

### 2. Asynchronous Ingestion Pipeline

When a document is uploaded, it is assigned a `PENDING` state and pushed to BullMQ. The client receives an immediate response with the document ID, avoiding HTTP timeouts on large texts.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as Documents Controller
    participant Service as Documents Service
    participant Queue as BullMQ Queue
    participant Worker as Ingestion Processor
    participant Chunker as Chunking Utility
    participant Embedder as Embeddings Service
    participant OpenAI as OpenAI API
    participant DB as PostgreSQL (pgvector)

    Client->>Controller: POST /documents { title, content }
    Controller->>Service: submitDocument(dto)
    Service->>DB: INSERT Document (status: PENDING)
    Service->>Queue: add("ingest-doc", { documentId })
    Service-->>Controller: Document record
    Controller-->>Client: 201 Created { id, status: PENDING }

    Queue->>Worker: process(job)
    Worker->>DB: UPDATE Document SET status = 'CHUNKING'
    Worker->>Chunker: chunkText(content, { size: 1200, overlap: 200 })
    Chunker-->>Worker: string[] chunks

    Worker->>DB: UPDATE Document SET status = 'EMBEDDING'
    loop Batches of 20 Chunks
        Worker->>Embedder: embedBatch(chunkBatch)
        Embedder->>OpenAI: POST /v1/embeddings (text-embedding-3-small)
        OpenAI-->>Embedder: number[][] vectors (1536 dim)
        Worker->>DB: INSERT INTO chunks (documentId, chunkIndex, content, embedding)
    end

    Worker->>DB: UPDATE Document SET status = 'READY'
    Client->>Controller: GET /documents/:id
    Controller-->>Client: 200 OK { id, status: READY }
```

### 3. Semantic Search & RAG Q&A Pipeline

Queries are converted into embeddings and matched against document chunks via vector cosine distance (`c.embedding <-> $1`). For Q&A requests, retrieved chunks are injected into a strict system prompt provided to `gpt-4o-mini`.

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Controller as Query Controller
    participant AnswerSvc as Answer Service
    participant Prometheus as Prometheus Metrics
    participant Redis as Redis Cache
    participant QuerySvc as Query Service
    participant OpenAI as OpenAI (Embeddings & Chat)
    participant DB as PostgreSQL (pgvector)

    Client->>Controller: POST /query/ask { query: "What is DocMind?" }
    Controller->>AnswerSvc: askQuestion(dto)
    AnswerSvc->>Prometheus: queriesCounter.inc()
    AnswerSvc->>AnswerSvc: Normalize & SHA-256 Hash query
    AnswerSvc->>Redis: GET docmind:cache:ask:<hash>
    
    alt Cache HIT
        Redis-->>AnswerSvc: Cached Answer JSON
        AnswerSvc->>Prometheus: cacheHitsCounter.inc()
        AnswerSvc-->>Controller: AnswerResponse { answer, sources, isCached: true }
        Controller-->>Client: 200 OK Response
    else Cache MISS
        Redis-->>AnswerSvc: null
        AnswerSvc->>QuerySvc: search({ query, limit: 5 })
        QuerySvc->>OpenAI: Embed query string
        OpenAI-->>QuerySvc: query vector [1536]
        QuerySvc->>DB: SELECT chunks ORDER BY embedding <-> $1 LIMIT 5
        DB-->>QuerySvc: SearchResult[]
        QuerySvc-->>AnswerSvc: Top matching chunks
        
        AnswerSvc->>Prometheus: generationTimer.startTimer()
        AnswerSvc->>OpenAI: POST /v1/chat/completions (Grounding Prompt + Context)
        OpenAI-->>AnswerSvc: Generated Answer with [Source N] citations
        AnswerSvc->>Prometheus: generationTimer.end()
        AnswerSvc->>Redis: SET docmind:cache:ask:<hash> (EX 86400s)
        AnswerSvc-->>Controller: AnswerResponse { answer, sources, isCached: false }
        Controller-->>Client: 200 OK Response
    end
```

### 4. Intelligent Redis Caching

The `AnswerService` normalizes user queries (case folding, stripping punctuation, collapsing whitespace) before computing a deterministic SHA-256 hash. Cached results expire after 24 hours (86,400 seconds) and include complete source metadata and citations.

### 5. Rate Limiting & Protection

DocMind uses `@nestjs/throttler` backed by Redis storage to enforce rate limits across distributed instances:
- **Global / Default**: 10 requests / minute
- **`/query/search`**: 20 requests / minute
- **`/query/ask`**: 5 requests / minute

### 6. API Key Authentication & Route Security

DocMind protects all sensitive API endpoints using a global `ApiKeyGuard` bound via `APP_GUARD`:
- **Dual-Header Support**: Accepts authentication credentials via either `x-api-key: <token>` or standard `Authorization: Bearer <token>`.
- **Public Endpoint Exemption**: Endpoints such as `/health`, `/metrics`, and `/api/docs` are marked with the `@Public()` decorator to allow unrestricted access for Prometheus scraping, load balancers, and documentation inspection.
- **Zero-Friction Development Mode**: If `API_KEY` is not defined in the environment, the guard automatically logs a development warning and allows incoming requests to pass without rejection.
- **OpenAPI / Swagger Integration**: The OpenAPI specification at `/api/docs` incorporates the `x-api-key` security scheme directly, allowing interactive authenticated test queries right from the browser.

### 7. Production Docker & Container Orchestration

DocMind includes an enterprise-grade containerization setup designed for minimal footprint and maximum security:

- **Multi-Stage Build (`Dockerfile`)**:
  - **`builder` stage**: Installs all build tools and TypeScript compilers in a clean Alpine environment to compile source files to `/app/dist`.
  - **`runner` stage**: Produces a slim production image containing only production dependencies (`npm ci --only=production`) and compiled JavaScript artifacts, drastically reducing attack surface and image size.
- **Security Hardening**: Drops root privileges by executing under the default non-root `node` user (`USER node`).
- **Compose Orchestration (`docker-compose.yml`)**:
  - Automatically spins up the `api`, `postgres` (`pgvector/pgvector:pg16`), and `redis` (`redis:7-alpine`) services.
  - Implements container-level healthchecks (`pg_isready`, `redis-cli ping`).
  - Utilizes `depends_on` with `condition: service_healthy` so the NestJS application only boots after database and cache services are fully operational.

---

## Observability & Monitoring

DocMind ships with production-grade observability built-in, requiring **zero external configuration** to start collecting metrics and structured logs.

### Structured Logging (Winston)

The application uses **Winston** via `nest-winston` as the global NestJS logger, replacing the default console logger with structured, machine-parseable output:

| Feature | Details |
|:---|:---|
| **Format** | JSON with `timestamp` and `ms` (execution delta) fields |
| **Service Metadata** | Every log line includes `{ service: "docmind-api" }` |
| **Console Transport** | Human-readable `simple()` format for development |
| **Log Level** | `debug` (captures all severity levels) |

**Example Log Output:**
```json
{
  "level": "info",
  "message": "Cache MISS for query: \"What is RAG?\". Running pipeline...",
  "service": "docmind-api",
  "timestamp": "2026-09-02T12:00:00.000Z",
  "ms": "+215ms"
}
```

### Prometheus Metrics

A Prometheus-compatible metrics endpoint is exposed at **`GET /metrics`** via `@willsoto/nestjs-prometheus`. Default Node.js runtime metrics (event loop lag, heap usage, GC, etc.) are enabled automatically.

#### Custom Application Metrics

| Metric Name | Type | Description | Labels / Buckets |
|:---|:---|:---|:---|
| `rag_queries_total` | Counter | Total RAG queries received via `/query/ask` | — |
| `rag_cache_hits_total` | Counter | Queries served directly from Redis cache | — |
| `llm_generation_duration_seconds` | Histogram | Time spent waiting for OpenAI Chat API response | `0.5, 1, 2, 5, 10` seconds |
| `vector_search_latency_seconds` | Histogram | Latency of pgvector cosine similarity search | `0.001, 0.005, 0.01, 0.05, 0.1` seconds |

#### Monitoring Architecture

```mermaid
graph LR
    APP["DocMind API<br/>(NestJS)"] -->|GET /metrics| PROM["Prometheus<br/>Scraper"]
    PROM --> GRAFANA["Grafana<br/>Dashboard"]
    APP -->|stdout / stderr| WINSTON["Winston<br/>JSON Logs"]
    WINSTON --> LOG_AGG["Log Aggregator<br/>(ELK / Loki / CloudWatch)"]
```

#### Example Prometheus Queries

```promql
# Cache hit rate (last 5 minutes)
rate(rag_cache_hits_total[5m]) / rate(rag_queries_total[5m])

# 95th percentile LLM generation latency
histogram_quantile(0.95, rate(llm_generation_duration_seconds_bucket[5m]))

# Average vector search latency
rate(vector_search_latency_seconds_sum[5m]) / rate(vector_search_latency_seconds_count[5m])
```

---

## Database Schema & Indexing

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

### Vector Index Configuration

Vector similarity lookups use an `ivfflat` index configured with cosine distance operations (`vector_cosine_ops`):

```sql
CREATE INDEX IF NOT EXISTS chunks_embedding_idx 
ON chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## API Reference

Interactive Swagger documentation is available at `http://localhost:3000/api/docs`.

### Documents Endpoints

#### 1. Ingest Document
`POST /documents`

Queues a new document for background chunking, embedding, and vector indexing.

**Request Body**
```json
{
  "title": "DocMind Architecture Overview",
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

#### 2. Upload Document File (PDF, DOCX, TXT)
`POST /documents/upload`

Uploads a document file (`multipart/form-data`) for automated text extraction and background RAG queueing. Maximum file size is **10MB**.

**Form Data Fields**
| Field | Type | Required | Description |
|:---|:---|:---|:---|
| `file` | binary | **Yes** | Supported formats: `.pdf` (`application/pdf`), `.docx` (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`), `.txt` (`text/plain`). Max 10MB. |
| `title` | string | No | Custom document title override. If omitted, title defaults to sanitized filename (e.g. `quarterly_report.pdf` → `quarterly_report`). |

**Response (`201 Created`)**
```json
{
  "message": "Document uploaded and queued for ingestion",
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "status": "PENDING"
}
```

**Common Error Responses (`400 Bad Request`)**
```json
// Missing file attachment
{
  "statusCode": 400,
  "timestamp": "2026-09-02T10:00:00.000Z",
  "path": "/documents/upload",
  "method": "POST",
  "error": "Bad Request",
  "message": "File is required"
}

// Unsupported extension or mime-type
{
  "statusCode": 400,
  "timestamp": "2026-09-02T10:00:00.000Z",
  "path": "/documents/upload",
  "method": "POST",
  "error": "Bad Request",
  "message": "Unsupported file format. Supported formats are .pdf, .docx, and .txt"
}
```

#### 3. List Documents
`GET /documents`

Retrieves a paginated list of ingested documents ordered chronologically.

**Query Parameters**
| Parameter | Type | Default | Validation / Constraints | Description |
|:---|:---|:---|:---|:---|
| `page` | number | `1` | Min: `1` | Current page number |
| `limit` | number | `10` | Min: `1`, Max: `100` | Number of documents per page |
| `order` | string | `DESC` | `ASC` \| `DESC` | Sort order by creation timestamp |

**Response (`200 OK`)**
```json
{
  "data": [
    {
      "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
      "title": "DocMind Architecture Overview",
      "status": "READY",
      "failureReason": null,
      "createdAt": "2026-09-02T10:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "totalItems": 42,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

#### 4. Get Document Status
`GET /documents/:id`

**Response (`200 OK`)**
```json
{
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "title": "DocMind Architecture Overview",
  "status": "READY",
  "failureReason": null,
  "createdAt": "2026-09-02T10:00:00.000Z"
}
```

#### 5. Delete Document
`DELETE /documents/:id`

Deletes a document record and purges all associated text chunks and vector embeddings from PostgreSQL.

**Response (`200 OK`)**
```json
{
  "message": "Document and associated chunks deleted successfully",
  "id": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b"
}
```

---

### Query & Retrieval Endpoints

#### 6. Semantic Vector Search
`POST /query/search`

Performs vector similarity search over all `READY` document chunks. Throttled to **20 requests/minute**.

**Request Body**
```json
{
  "query": "How does DocMind handle background processing?",
  "limit": 3
}
```

**Response (`200 OK`)**
```json
{
  "query": "How does DocMind handle background processing?",
  "count": 1,
  "results": [
    {
      "chunkId": "f9e2b10a-3c4d-4e5f-9a8b-1c2d3e4f5a6b",
      "content": "DocMind uses BullMQ backed by Redis for background processing...",
      "similarity": 0.8924,
      "documentTitle": "DocMind Architecture Overview",
      "documentId": "c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b"
    }
  ]
}
```

#### 7. Ask Question (RAG with Citations)
`POST /query/ask`

Executes the full RAG pipeline: retrieves top-k chunks, queries OpenAI for a grounded answer with inline citations, and caches the result in Redis. Throttled to **5 requests/minute**.

**Request Body**
```json
{
  "query": "How does DocMind handle background processing?"
}
```

**Response (`200 OK`)**
```json
{
  "query": "How does DocMind handle background processing?",
  "answer": "DocMind handles background processing using BullMQ backed by Redis [Source 1]. This ensures document ingestion and embedding generation do not block HTTP request lifecycles.",
  "sources": [
    {
      "citation": "[Source 1]",
      "documentTitle": "DocMind Architecture Overview",
      "chunkId": "f9e2b10a-3c4d-4e5f-9a8b-1c2d3e4f5a6b",
      "similarity": 0.8924
    }
  ],
  "isCached": false
}
```

---

### Observability Endpoints

#### 8. Prometheus Metrics
`GET /metrics`

Returns all application and runtime metrics in Prometheus exposition format. Includes both default Node.js metrics (heap, GC, event loop) and custom RAG pipeline metrics.

**Response (`200 OK`, `text/plain`)**
```text
# HELP rag_queries_total Total number of RAG queries received
# TYPE rag_queries_total counter
rag_queries_total 42

# HELP rag_cache_hits_total Total number of RAG queries served from Redis cache
# TYPE rag_cache_hits_total counter
rag_cache_hits_total 28

# HELP llm_generation_duration_seconds Time spent waiting for the OpenAI Chat API
# TYPE llm_generation_duration_seconds histogram
llm_generation_duration_seconds_bucket{le="0.5"} 2
llm_generation_duration_seconds_bucket{le="1"} 8
llm_generation_duration_seconds_bucket{le="2"} 12
llm_generation_duration_seconds_bucket{le="5"} 14
llm_generation_duration_seconds_bucket{le="10"} 14
llm_generation_duration_seconds_bucket{le="+Inf"} 14
llm_generation_duration_seconds_sum 21.54
llm_generation_duration_seconds_count 14

# HELP vector_search_latency_seconds Latency of vector similarity search in PostgreSQL
# TYPE vector_search_latency_seconds histogram
vector_search_latency_seconds_bucket{le="0.001"} 5
vector_search_latency_seconds_bucket{le="0.005"} 18
vector_search_latency_seconds_bucket{le="0.01"} 25
vector_search_latency_seconds_bucket{le="0.05"} 40
vector_search_latency_seconds_bucket{le="0.1"} 42
vector_search_latency_seconds_bucket{le="+Inf"} 42
vector_search_latency_seconds_sum 0.386
vector_search_latency_seconds_count 42
```

#### 9. Health Check
`GET /health`

Performs active probes against PostgreSQL and Redis, reporting uptime, memory usage, and component latency. Returns HTTP 200 when healthy or HTTP 503 if any dependency is degraded.

**Response (`200 OK`)**
```json
{
  "status": "ok",
  "timestamp": "2026-09-02T13:00:00.000Z",
  "uptimeSeconds": 3600,
  "responseTimeMs": 4,
  "memory": {
    "heapUsedMb": 45.12,
    "heapTotalMb": 62.45,
    "rssMb": 98.32
  },
  "services": {
    "database": {
      "status": "up",
      "latencyMs": 2
    },
    "redis": {
      "status": "up",
      "latencyMs": 1
    }
  }
}
```

---

### Standardized Error Format

All exceptions (both HTTP client errors and unhandled server errors) are intercepted by the global `AllExceptionsFilter` and returned in a unified JSON structure:

```json
{
  "statusCode": 404,
  "timestamp": "2026-09-02T13:00:00.000Z",
  "path": "/documents/c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b",
  "method": "DELETE",
  "error": "Not Found",
  "message": "Document with ID c7b5f3a0-8e1d-4d74-912b-3a4d5e6f7a8b not found"
}
```

---

## Environment Configuration

Configure application settings via environment variables (or `.env` file):

| Variable | Type | Default | Description |
|:---|:---|:---|:---|
| `PORT` | number | `3000` | HTTP application port |
| `API_KEY` | string | — | Secret API key for endpoint authentication (optional in dev) |
| `DATABASE_URL` | string | `postgresql://docmind:docmind_password@localhost:5432/docmind` | PostgreSQL connection string |
| `REDIS_HOST` | string | `localhost` | Redis server hostname |
| `REDIS_PORT` | number | `6379` | Redis server port |
| `OPENAI_API_KEY` | string | — | OpenAI API Key (**Required**) |
| `EMBEDDING_MODEL` | string | `text-embedding-3-small` | OpenAI embedding model |
| `EMBEDDING_DIMENSIONS` | number | `1536` | Dimensionality of embedding vectors |
| `CHAT_MODEL` | string | `gpt-4o-mini` | OpenAI Chat model for RAG synthesis |
| `CHUNK_SIZE_CHARS` | number | `1200` | Maximum character length per text chunk |
| `CHUNK_OVERLAP_CHARS` | number | `200` | Character overlap between consecutive chunks |
| `RATE_LIMIT_TTL` | number | `60000` | Throttler time-to-live window in milliseconds |
| `RATE_LIMIT_MAX` | number | `10` | Default maximum requests per TTL window |

---

## Testing & Quality Assurance

DocMind features a comprehensive automated testing suite covering unit, utility, integration, and full HTTP lifecycle E2E scenarios.

### Running Tests

```bash
# Run unit & integration test suites
npm test

# Run end-to-end (E2E) tests against simulated HTTP application
npm run test:e2e

# Run test coverage report
npm run test:cov

# Run linter checks
npm run lint
```

### Test Suite Breakdown

| Test Suite | Path | Type | Key Verifications Covered |
|:---|:---|:---|:---|
| **File Text Extraction** | `src/documents/utils/file-extractor.util.spec.ts` | Unit | Text extraction from PDF (`pdf-parse`), DOCX (`mammoth`), and TXT; title sanitization, whitespace collapsing, corruption detection, empty buffer rejection. |
| **Documents Controller** | `src/documents/documents.controller.spec.ts` | Unit | JSON document ingestion, multipart file uploads, custom title overrides, automatic sanitized filename fallback, missing file `400 Bad Request` exceptions. |
| **Chunking Logic** | `src/ingestion/chunking.util.spec.ts` | Unit | Word-boundary preservation, sliding window overlap, edge cases (empty text, small text, large paragraphs, consecutive whitespace). |
| **RAG Answer Service** | `src/query/answer.service.spec.ts` | Unit | Instant sub-millisecond Redis cache hits, cache misses invoking vector search & OpenAI chat completions, Prometheus histogram timers and query counters. |
| **Vector Search Service** | `src/query/query.service.spec.ts` | Unit | Cosine distance `<->` operator SQL formatting, vector parameter serialization (`[0.1, 0.2, ...]`), and limit boundaries. |
| **Documents Service** | `src/documents/documents.service.spec.ts` | Unit | Entity persistence, BullMQ job enqueueing, paginated `findAndCount` queries, cascade deletion of child chunks. |
| **API Key Guard** | `src/auth/guards/api-key.guard.spec.ts` | Unit | `x-api-key` and `Authorization: Bearer` extraction, `@Public()` route bypass, dev mode fallback, HTTP 401 Unauthorized rejection on invalid keys. |
| **Health Controller** | `src/health/health.controller.spec.ts` | Unit | Active DB and Redis ping reporting, HTTP 200 OK on healthy components, HTTP 503 Service Unavailable upon dependency outage. |
| **Exception Filter** | `src/common/filters/all-exceptions.filter.spec.ts` | Unit | Unified JSON error responses, validation array extraction, masking internal errors as HTTP 500 while logging full stack traces. |
| **Application Lifecycle E2E** | `test/app.e2e-spec.ts` | E2E | HTTP GET `/health`, `/metrics`, unhandled route 404 formatting, and global filter verification. |
| **Documents Pipeline E2E** | `test/documents.e2e-spec.ts` | E2E | Full HTTP lifecycle for raw text ingestion, multipart file uploads (`.pdf`, `.docx`, `.txt`), paginated document listing with metadata, and cascade deletion. |

> [!NOTE]
> All unit and E2E suites leverage pure ESM mock mappings (`src/__mocks__/`) to execute hermetically in sub-4 seconds without requiring live database or Redis infrastructure on localhost.

### CI/CD Pipeline (GitHub Actions)

DocMind enforces automated quality gates on every commit and pull request to the `main` branch via [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

The pipeline spins up native containerized services and runs nine sequential quality stages:

```mermaid
flowchart LR
    A[Trigger: Push / PR] --> B[Spin up Services<br/>PostgreSQL 16 pgvector + Redis 7]
    B --> C[Checkout & Setup Node.js 20]
    C --> D[Install Deps: npm ci]
    D --> E[Linting: npm run lint]
    E --> F[Format Check: prettier --check .]
    F --> G[Run pgvector Migrations]
    G --> H[Unit & E2E Tests + Coverage]
    H --> I[Application Build: npm run build]
    I --> J[Docker Build Verification]
```

#### Pipeline Configuration & Stages

| Stage | Command / Action | Description |
|:---|:---|:---|
| **Triggers** | `push: [main]`, `pull_request: [main]` | Runs automated checks on every commit or PR against the production branch. |
| **Services** | `pgvector/pgvector:pg16`, `redis:7-alpine` | Containerized service containers with automated health checks (`pg_isready`, `redis-cli ping`). |
| **1. Checkout** | `actions/checkout@v4` | Fetches codebase context into runner workspace. |
| **2. Setup Node.js** | `actions/setup-node@v4` | Configures Node.js v20 LTS with automated `npm` dependency caching. |
| **3. Install Deps** | `npm ci` | Deterministic, clean installation of exact package tree from `package-lock.json`. |
| **4. Code Linting** | `npm run lint` | Validates TypeScript rules, naming conventions, and code hygiene via ESLint. |
| **5. Format Check** | `npx prettier --check .` | Verifies consistent code style across the codebase according to `.prettierrc`. |
| **6. DB Migrations** | `npx ts-node src/migrations/run-pgvector.ts` | Applies pgvector extension, chunks schema, and `ivfflat` index on PostgreSQL 16. |
| **7. Tests & Coverage** | `npm run test:cov && npm run test:e2e` | Executes 100% of unit and end-to-end integration tests, generating coverage reports. |
| **8. App Build** | `npm run build` | Compiles NestJS TypeScript into production-ready JavaScript bundle in `dist/`. |
| **9. Docker Build** | `docker build -t docmind-test .` | Validates multi-stage Dockerfile build, asset bundling, and runner image creation. |
| **Artifacts** | `actions/upload-artifact@v4` | Uploads HTML & LCOV coverage reports preserved for 14 days. |

---

## Getting Started

### Prerequisites

- **Node.js** (v20+ LTS) or **Docker** & **Docker Compose**
- **OpenAI API Key**

---

### Option A: Run Full Stack with Docker Compose (Recommended)

The easiest way to run DocMind in a production-identical environment:

```bash
# 1. Clone the repository
git clone https://github.com/mo74x/Docmind.git
cd Docmind

# 2. Configure environment variables
cp .env.example .env
# Edit .env and supply your OPENAI_API_KEY

# 3. Build & start all containers (API, PostgreSQL with pgvector, Redis)
docker compose up --build -d

# 4. Run vector extension & index migration
npx ts-node src/migrations/run-pgvector.ts
```

---

### Option B: Local Node.js Development

```bash
# 1. Clone & Install Dependencies
git clone https://github.com/mo74x/Docmind.git
cd Docmind
npm install

# 2. Configure Environment
cp .env.example .env
# Edit .env and supply your OPENAI_API_KEY

# 3. Start Infrastructure Dependencies
docker compose up -d postgres redis

# 4. Run Vector Migrations
npx ts-node src/migrations/run-pgvector.ts

# 5. Start Application
npm run start:dev
```

### Available Endpoints

| Endpoint | Description |
|:---|:---|
| `http://localhost:3000` | API Server |
| `http://localhost:3000/api/docs` | Interactive Swagger UI |
| `http://localhost:3000/health` | Health Check (DB & Redis) |
| `http://localhost:3000/metrics` | Prometheus Metrics |

---

### Quick Testing (cURL Examples)

```bash
# 1. Upload a document file (PDF, DOCX, TXT)
curl -X POST http://localhost:3000/documents/upload \
  -H "x-api-key: your-secret-api-key" \
  -F "file=@./whitepaper.pdf" \
  -F "title=Whitepaper Architecture"

# 2. Ingest raw text document
curl -X POST http://localhost:3000/documents \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{"title": "DocMind Architecture", "content": "DocMind is an asynchronous RAG backend built on NestJS..."}'

# 3. Semantic vector search
curl -X POST http://localhost:3000/query/search \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{"query": "How does DocMind handle background processing?", "limit": 3}'

# 4. Grounded RAG Q&A with citations
curl -X POST http://localhost:3000/query/ask \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{"query": "How does DocMind handle background processing?"}'
```

---

## Project Structure

```text
docmind/
├── Dockerfile                      # Multi-stage production container build (Node 20 Alpine)
├── docker-compose.yml              # PostgreSQL (pgvector), Redis & API container orchestration
├── .env.example                    # Environment configuration template
├── package.json
├── tsconfig.json
├── test/                           # E2E Test suites & configurations
│   ├── app.e2e-spec.ts             # Health, metrics & filter E2E tests
│   ├── documents.e2e-spec.ts       # Document ingestion, file upload, pagination & deletion E2E tests
│   └── jest-e2e.json               # E2E Jest configuration with ESM module mapping
├── src/
│   ├── main.ts                     # Bootstrap, Swagger, Winston Logger, Filters & Validation
│   ├── app.module.ts               # Root module (TypeORM, Redis, BullMQ, Throttler, Prometheus, Health)
│   ├── __mocks__/                  # Pure ESM module mappings for high-speed isolated testing
│   │   ├── ioredis.ts
│   │   ├── nestjs-bullmq.ts
│   │   ├── nestjs-config.ts
│   │   └── nestjs-typeorm.ts
│   ├── auth/                       # API Key Authentication & Route Security
│   │   ├── auth.module.ts          # Global APP_GUARD provider
│   │   ├── decorators/
│   │   │   └── public.decorator.ts # @Public() bypass decorator
│   │   └── guards/
│   │       ├── api-key.guard.ts    # Dual-header API key validator & dev bypass
│   │       └── api-key.guard.spec.ts
│   ├── common/
│   │   ├── dto/                    # Reusable DTOs
│   │   │   ├── pagination.dto.ts   # Pagination query validation DTO (page, limit, order)
│   │   │   └── paginated-response.dto.ts # Generic paginated response wrapper
│   │   └── filters/
│   │       ├── all-exceptions.filter.ts      # Global exception filter & structured error logging
│   │       └── all-exceptions.filter.spec.ts
│   ├── config/
│   │   └── configuration.ts        # Config loader & environment parsing
│   ├── health/
│   │   ├── health.controller.ts    # DB & Redis connectivity & uptime health probe
│   │   ├── health.controller.spec.ts
│   │   └── health.module.ts
│   ├── migrations/
│   │   └── run-pgvector.ts         # pgvector extension & ivfflat index migration
│   ├── documents/
│   │   ├── document.entity.ts      # Document entity & lifecycle status enum
│   │   ├── chunk.entity.ts         # Chunk entity with vector(1536) column
│   │   ├── documents.controller.ts # Ingestion, file upload, paginated listing, status & DELETE endpoints
│   │   ├── documents.controller.spec.ts
│   │   ├── documents.service.ts    # Document state management, queue producer & deletion
│   │   ├── documents.service.spec.ts
│   │   ├── documents.module.ts
│   │   ├── dto/
│   │   │   ├── ingest-document.dto.ts
│   │   │   └── upload-document.dto.ts # Multipart file upload DTO & Swagger file schema
│   │   └── utils/
│   │       ├── file-extractor.util.ts      # PDF, DOCX & TXT text extraction & title sanitization
│   │       └── file-extractor.util.spec.ts
│   ├── ingestion/
│   │   ├── ingestion.processor.ts  # BullMQ worker: chunking -> batch embedding -> DB
│   │   ├── chunking.util.ts        # Boundary-aware text chunking logic
│   │   ├── chunking.util.spec.ts
│   │   └── ingestion.module.ts
│   ├── embeddings/
│   │   ├── embeddings.service.ts   # OpenAI batch embeddings client
│   │   └── embeddings.module.ts
│   ├── query/
│   │   ├── query.controller.ts     # Semantic search & Q&A endpoints with rate limits
│   │   ├── query.service.ts        # Vector similarity search over pgvector
│   │   ├── query.service.spec.ts
│   │   ├── answer.service.ts       # RAG answer synthesis, Redis caching & Prometheus instrumentation
│   │   ├── answer.service.spec.ts
│   │   ├── query.module.ts         # Prometheus metric providers (counters & histograms)
│   │   └── dto/
│   │       └── search-query.dto.ts # Query validation DTO
│   └── redis/
│       └── redis.module.ts         # Global Redis client provider
```