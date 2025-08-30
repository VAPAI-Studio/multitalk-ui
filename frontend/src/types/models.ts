// All core data models have been moved to api.ts to avoid circular import issues
// This file is kept for potential future model definitions that don't cause import conflicts

// If you need to add new models, consider:
// 1. Adding them directly to api.ts if they're used in API responses
// 2. Adding them here if they're pure domain models with no circular dependencies
// 3. Creating specific files for different domains (e.g., user-models.ts, workflow-models.ts)