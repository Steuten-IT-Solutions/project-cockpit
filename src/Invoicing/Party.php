<?php

declare(strict_types=1);

namespace Cockpit\Invoicing;

use InvalidArgumentException;

/**
 * Seller or buyer of an invoice, as it is frozen into the invoice.
 */
final readonly class Party
{
    /**
     * @param string $country ISO 3166-1 alpha-2 code, e.g. "DE"
     * @param ?string $taxNumber German Steuernummer (BT-32 for the seller)
     * @param ?string $vatId USt-IdNr. (BT-31 / BT-48)
     */
    public function __construct(
        public string $name,
        public string $street,
        public string $postcode,
        public string $city,
        public string $country = 'DE',
        public ?string $taxNumber = null,
        public ?string $vatId = null,
        public ?string $email = null,
        public ?string $phone = null,
        public ?string $contactName = null,
    ) {
        foreach (['name' => $name, 'street' => $street, 'postcode' => $postcode, 'city' => $city] as $field => $value) {
            if (trim($value) === '') {
                throw new InvalidArgumentException("Party field '$field' must not be empty.");
            }
        }
        if (!preg_match('/^[A-Z]{2}$/D', $country)) {
            throw new InvalidArgumentException('Country must be an ISO 3166-1 alpha-2 code.');
        }
    }
}
