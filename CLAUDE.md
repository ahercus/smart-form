# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Fit Form** transforms static PDF forms into intelligent, interactive experiences. Users upload PDF forms, the system identifies input fields via AI, presents them in a wizard interface, and auto-populates values from saved profiles.

## Tech Stack

- **Framework**: Next.js 16 (App Router) with TypeScript (strict mode)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database/Auth/Storage**: Supabase (PostgreSQL)
- **PDF**: react-pdf (client display), pdf-lib (server manipulation)
- **AI**: Azure Document Intelligence (field detection), Gemini (refinement & auto-fill)
- **Deployment**: Vercel

**Note**: Row-Level Security (RLS) will be applied at the end after thorough testing.

### Gemini Models

**Use only Gemini 3 models.** Do not use Gemini 2.x models anywhere in the codebase.

| Model | Use Case |
|-------|----------|
| `gemini-3-flash-preview` | All vision tasks, question generation, answer parsing, memory extraction |
| `gemini-3-pro-preview` | Reserved for complex reasoning (not currently used) |

Thinking levels for Flash: `MINIMAL` (default, fastest) or `MEDIUM` (more reasoning).

## Development Principles

**No placeholders or dummy code.** Never introduce mock data, placeholder implementations, or dummy content. If a feature requires an external API or service that isn't configured, the code should fail with a clear error message rather than silently returning fake data. Hidden placeholder debt is worse than a visible failure.

## Architecture Principles

### Separation of Concerns

Every feature follows this structure:
```
feature/
├── page.tsx              # Route + orchestration only (50-100 lines max)
├── components/           # UI components (rendering only, no business logic)
├── hooks/                # State management, effects, API calls
├── lib/                  # Pure functions, types, constants (no React)
└── api/                  # Server-side routes
```

### File Size Guidelines

| File Type | Target | Refactor Signal |
|-----------|--------|-----------------|
| page.tsx | ~50-100 lines | >150 lines |
| Components | ~200 lines | >400 lines |
| Hooks | ~150 lines | >300 lines |
| API routes | ~100 lines | >200 lines |

### shadcn/ui Philosophy

Use shadcn/ui components exclusively when available. Do not create custom components when shadcn provides an equivalent. Customization happens through Tailwind classes on shadcn primitives.

### Coordinate System

All field coordinates are stored and rendered as percentages (0-100) relative to the page container. This enables responsive positioning across viewport sizes.

```typescript
interface NormalizedCoordinates {
  left: number;   // Percentage (0-100)
  top: number;    // Percentage (0-100)
  width: number;  // Percentage (0-100)
  height: number; // Percentage (0-100)
}
```

### Logging

Use structured logging with prefix `[AutoForm]`:
```typescript
console.log(`[AutoForm] Document status:`, { id, status, timestamp });
```

## Core Data Flow

1. **Upload**: PDF → Supabase Storage → Document record created
2. **Processing**: Azure Document Intelligence analysis → Field extraction → Gemini refinement
3. **Display**: Wizard view (primary) or Overlay view (verification)
4. **Auto-fill**: Gemini matches user profile to form fields
5. **Export**: pdf-lib draws values onto original PDF

## Database Tables

- `profiles`: User data, saved info for auto-fill, signatures
- `documents`: Uploaded PDFs, processing status, cached API responses
- `extracted_fields`: Individual form fields with coordinates and values

## Processing States

`uploading` → `analyzing` → `extracting` → `refining` → `ready` (or `failed`)

## Mobile Patterns

- Use `Drawer` component (bottom sheet) for mobile UI - pulls up over the PDF in wizard mode
- Single-field focus mode in wizard view with swipe navigation
- Long-press (500ms) to enter field edit mode in overlay view
- Minimum touch targets: 44x44px

## Field Types

`text` | `textarea` | `checkbox` | `radio` | `date` | `signature` | `unknown`
