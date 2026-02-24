# Compile-Time Enforcement as Process Guard

## Core Principle

**Technical solutions should reveal and enforce good processes, not hide process problems.**

When backend removes an error type, frontend code that handles it should **fail to compile**. This is not a bug - it's a feature that prevents code rot and enforces intentional cleanup.

## The Feature: Breaking Builds on Purpose

Consider this scenario:
1. Backend API removes `BAD_USERNAME` error (no longer possible)
2. Frontend still has code handling this error case
3. **Desired outcome**: Frontend fails to compile

Why is this good?

- **Forces awareness**: Frontend team knows something changed
- **Prevents dead code**: Handler for impossible error is immediately identified
- **Enforces coordination**: Backend can't silently remove errors without frontend acknowledgment
- **Makes cleanup intentional**: Dead code removal becomes part of the workflow, not forgotten

## The Alternative (and Why It's Worse)

If we use string literals or loose typing:
```typescript
if (result.type === "BAD_USERNAME") {  // ❌ Compiles even if error no longer exists
    // This code is now dead, but nobody knows
}
```

This **hides the problem**:
- Dead code accumulates over time
- No signal that something changed
- Cleanup becomes archeological work ("when did this become impossible?")
- Teams drift apart (backend removes things, frontend unaware)

## Broken Windows Theory Applied to Code

The "Broken Windows Theory" states that visible signs of disorder (like a broken window) encourage further disorder.

In code:
- **One piece of dead code** → "This codebase has dead code, adding more doesn't matter"
- **No compile errors** → "Nobody will notice if I don't clean up"
- **Gradual decay** → Technical debt compounds until cleanup requires major refactoring

**Prevention beats cleanup**: Forcing immediate compile errors prevents the first broken window.

## When Breaking Builds Reveals Process Problems

If frontend frequently breaks because backend removes errors without warning, **the technical solution is working correctly** - it's revealing a **process problem**:

**The problem is NOT**: "Frontend breaks too easily"
**The real problem is**: "Backend removes errors without deprecation or coordination"

**Good processes revealed by this approach**:
1. Backend deprecates errors before removing them
2. Teams coordinate on breaking changes
3. Error removal is intentional and communicated
4. Cleanup happens immediately, not later (or never)

## Design Philosophy

Type systems exist to catch mistakes at compile-time rather than runtime. Extending this principle:

- **Compile-time errors** > Runtime errors > Silent failures
- **Impossible states unrepresentable** in the type system
- **Dead code impossible to write** (or at least impossible to ignore)

When a technical decision forces better processes, that's not a side effect - it's the main benefit.

## Summary

Frontend breaking when backend removes errors is a **feature that**:
1. Prevents dead code accumulation (Broken Windows)
2. Enforces intentional cleanup
3. Reveals poor processes (lack of coordination/deprecation)
4. Makes impossible states unrepresentable

The alternative (compiling dead code) optimizes for short-term convenience at the cost of long-term code health.
