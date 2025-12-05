# Batch Prize Upload Examples

This directory contains comprehensive examples for the batch prize upload tool (`addPrizesBatch.js`).

## Usage

```powershell
# Validate prizes (dry run)
node scripts/interactions/LazyLotto/admin/addPrizesBatch.js -f examples/prizes-hbar-only.json -dry

# Actually upload prizes
node scripts/interactions/LazyLotto/admin/addPrizesBatch.js -f examples/prizes-hbar-only.json
```

## Prize Package Types

Each package is **ONE** of these types:

| Type | Description | Components |
|------|-------------|------------|
| **Type A** | HBAR only | `hbar` |
| **Type B** | Fungible Token only | `ft` |
| **Type C** | NFT(s) only | `nfts` (one or more collections) |
| **Type D** | HBAR + NFT(s) | `hbar` + `nfts` |
| **Type E** | FT + NFT(s) | `ft` + `nfts` |

### Invalid Combinations:
- ❌ HBAR + FT (not supported by contract)
- ❌ HBAR + FT + NFT (not supported)
- ❌ Empty package (must have at least one component)

## Example Files

### Type-Specific Examples

| File | Type | Description |
|------|------|-------------|
| `prizes-hbar-only.json` | A | Multiple HBAR-only packages |
| `prizes-ft-only.json` | B | Multiple FT-only packages (can be different tokens) |
| `prizes-nft-single-serial.json` | C | One NFT (single serial) |
| `prizes-nft-multiple-serials.json` | C | Multiple serials from one collection |
| `prizes-nft-multiple-collections.json` | C | Multiple collections in one package |
| `prizes-hbar-and-nft.json` | D | HBAR + NFT combinations |
| `prizes-ft-and-nft.json` | E | FT + NFT combinations |
| `prizes-mixed.json` | Mixed | All types A-E in one batch |

## Package Structure

### Type A: HBAR Only
```json
{
  "hbar": "10"
}
```
- `hbar`: String representing HBAR amount (e.g., "10" = 10 HBAR)
- Automatically converted to tinybars

### Type B: FT Only
```json
{
  "ft": {
    "token": "0.0.12345",
    "amount": "1000"
  }
}
```
- `ft.token`: Hedera token ID
- `ft.amount`: Human-readable amount (e.g., "1000" tokens)
- **Script automatically converts to base units using token decimals from mirror node**

### Type C: NFT Only
```json
{
  "nfts": [
    {
      "token": "0.0.67890",
      "serials": [1, 2, 3]
    },
    {
      "token": "0.0.99999",
      "serials": [42]
    }
  ]
}
```
- `nfts`: Array of NFT collections (one or more)
- Each collection has `token` and `serials` array
- Can have single serial `[1]` or multiple `[1, 2, 3]`

### Type D: HBAR + NFT
```json
{
  "hbar": "50",
  "nfts": [
    {
      "token": "0.0.99999",
      "serials": [1]
    }
  ]
}
```
- Combines HBAR with one or more NFT collections

### Type E: FT + NFT
```json
{
  "ft": {
    "token": "0.0.12345",
    "amount": "500"
  },
  "nfts": [
    {
      "token": "0.0.67890",
      "serials": [4, 5]
    }
  ]
}
```
- Combines FT (human-readable amount) with one or more NFT collections

## NFT Collection Variations

Type C, D, and E packages can include NFTs in various ways:

**Single collection, single serial:**
```json
"nfts": [{"token": "0.0.99999", "serials": [42]}]
```

**Single collection, multiple serials:**
```json
"nfts": [{"token": "0.0.99999", "serials": [1, 2, 3, 4, 5]}]
```

**Multiple collections, each with different serials:**
```json
"nfts": [
  {"token": "0.0.11111", "serials": [1, 2]},
  {"token": "0.0.22222", "serials": [100]},
  {"token": "0.0.33333", "serials": [5, 10, 15]}
]
```

## NFT Allowances

When NFT prizes are included, the script automatically:
1. Collects all unique NFT collections across all packages
2. Checks existing NFT allowances
3. Only requests new allowances for collections not already approved
4. Sets "approve for all" allowance for the LazyLotto storage contract

## Batch Processing

The script processes packages **sequentially**, creating one transaction per package. This means:
- Each package is submitted independently
- If one package fails, others can still succeed
- Progress is shown for each package
- Failed packages are reported at the end

## Notes

- **Pool ID**: Must match your target lottery pool
- **Comments**: Fields starting with `_` are ignored (documentation only)
- **Decimal Handling**: 
  - HBAR amounts are in HBAR (automatically converted to tinybars)
  - **FT amounts are human-readable** (e.g., "1000" means 1000 tokens)
  - Script automatically fetches token decimals from mirror node and converts to base units
- **Validation**: Use `-dry` flag to validate all packages before submitting
- **Error Handling**: Script continues processing even if individual packages fail

## Example Workflow

1. **Choose or create example**:
   ```powershell
   # Copy an example
   cp examples/prizes-hbar-and-nft.json my-prizes.json
   
   # Or start from scratch with the main example
   cp example-prizes.json my-prizes.json
   ```

2. **Edit with your values**:
   - Update `poolId` to match your pool
   - Update token IDs with real Hedera IDs
   - Update amounts/serials appropriately

3. **Validate**:
   ```powershell
   node scripts/interactions/LazyLotto/admin/addPrizesBatch.js -f my-prizes.json -dry
   ```

4. **Upload**:
   ```powershell
   node scripts/interactions/LazyLotto/admin/addPrizesBatch.js -f my-prizes.json
   ```

## Complete Example

See `example-prizes.json` for a file containing all five types (A-E) in one batch.
