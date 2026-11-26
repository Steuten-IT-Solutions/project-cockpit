<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use InvalidArgumentException;

/**
 * One position of an invoice. Quantities are stored in thousandths so that
 * 1.5 hours is 1500; prices and amounts are whole cents.
 */
final readonly class InvoiceLine
{
    /** UN/ECE Recommendation 20 unit codes the cockpit offers, with German labels. */
    public const UNITS = ['C62' => 'Stück', 'HUR' => 'Std.', 'DAY' => 'Tag(e)', 'MON' => 'Monat(e)', 'LS' => 'pauschal'];

    /**
     * @param int $vatRate percent, e.g. 19 or 7; 0 for small-business or exempt lines
     */
    public function __construct(
        public string $name,
        public int $quantityMilli,
        public string $unit,
        public int $unitPriceCents,
        public int $vatRate = 0,
        public ?string $description = null,
    ) {
        if (trim($name) === '') {
            throw new InvalidArgumentException('A line needs a name.');
        }
        if ($quantityMilli <= 0) {
            throw new InvalidArgumentException('The quantity must be positive.');
        }
        if (!isset(self::UNITS[$unit])) {
            throw new InvalidArgumentException("Unknown unit '$unit'.");
        }
        if ($unitPriceCents < 0) {
            throw new InvalidArgumentException('The unit price must not be negative.');
        }
        if (!in_array($vatRate, [0, 7, 19], true)) {
            throw new InvalidArgumentException('Only 0, 7 and 19 percent are supported.');
        }
    }

    /** Net amount of the line in cents, rounded half up. */
    public function netCents(): int
    {
        return intdiv($this->quantityMilli * $this->unitPriceCents + 500, 1000);
    }
}
