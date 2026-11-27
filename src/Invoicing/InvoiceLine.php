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
     * @param int $discountBp discount on the line in hundredths of a percent (1000 = 10 %)
     */
    public function __construct(
        public string $name,
        public int $quantityMilli,
        public string $unit,
        public int $unitPriceCents,
        public int $vatRate = 0,
        public ?string $description = null,
        public int $discountBp = 0,
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
        if ($discountBp < 0 || $discountBp > 10000) {
            throw new InvalidArgumentException('The discount must be between 0 and 100 percent.');
        }
    }

    /** Quantity times price in cents, rounded half up, before the discount. */
    public function amountBeforeDiscountCents(): int
    {
        return intdiv($this->quantityMilli * $this->unitPriceCents + 500, 1000);
    }

    /** The discount in cents, rounded half up (EN 16931 line allowance, BT-136). */
    public function discountCents(): int
    {
        return intdiv($this->amountBeforeDiscountCents() * $this->discountBp + 5000, 10000);
    }

    /** Net amount of the line in cents after the discount (BT-131). */
    public function netCents(): int
    {
        return $this->amountBeforeDiscountCents() - $this->discountCents();
    }
}
