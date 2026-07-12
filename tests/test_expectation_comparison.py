from unittest.mock import patch

from scripts import generate_expectation_comparison


def test_comparison_basis_reads_engine_dividend_constant() -> None:
    with patch.object(generate_expectation_comparison.engine, "NET_POINTS_TO_DOLLARS", 2_000_000.0):
        basis = generate_expectation_comparison._comparison_basis()

    assert "$20,000-per-net-point per-holder" in basis
    assert "$2,000,000-per-net-point full-float" in basis
