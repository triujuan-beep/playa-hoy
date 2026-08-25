from __future__ import annotations

import unittest

from parser import abundance_severity, parse_feature


class ParserTests(unittest.TestCase):
    def test_positive_report_omits_identity_and_media(self) -> None:
        feature = {
            "geometry": {"type": "Point", "coordinates": [-3.867, 36.752]},
            "properties": {
                "fichero": "must-not-survive.jpg",
                "nomfich": 123,
                "fecha": "2026-08-25 10:30:00",
                "popup": """
                    <div data-codigo="42"><div class="infoMedusa" data-idmedusa="7">Pelagia noctiluca</div>
                    <div class="detalles-popup"><p><i class="zmdi zmdi-account"></i>Private Person</p>
                    <p><i class="zmdi zmdi-pin-drop"></i>Burriana</p></div>
                    <div class="card-stats"><div class="stat"><div class="type">Cantidad</div><div class="value">6-10</div></div>
                    <div class="stat"><div class="type">Tamaño</div><div class="value">10-20 cm</div></div></div></div>
                """,
            },
        }
        parsed = parse_feature(feature)
        assert parsed is not None
        self.assertEqual(parsed.reportType, "sighting")
        self.assertEqual(parsed.beachName, "Burriana")
        self.assertEqual(parsed.abundanceSeverity, 1.5)
        serialized = str(parsed)
        self.assertNotIn("Private Person", serialized)
        self.assertNotIn("must-not-survive", serialized)

    def test_other_objects_are_not_positive_jellyfish_sightings(self) -> None:
        feature = {
            "geometry": {"coordinates": [-3.9, 36.7]},
            "properties": {
                "fecha": "2026-08-25 10:00:00",
                "popup": '<div data-codigo="7"><div class="infoMedusa" data-idmedusa="152">Manchas de aceite</div></div>',
            },
        }
        parsed = parse_feature(feature)
        assert parsed is not None
        self.assertEqual(parsed.reportType, "unknown")
        self.assertEqual(parsed.typeEvidence, "popup:non_jellyfish_taxon_or_object")

    def test_no_sighting_and_pending(self) -> None:
        base = {"geometry": {"coordinates": [-4.0, 36.7]}, "properties": {"fecha": "2026-08-25 09:00:00"}}
        no_sighting = {**base, "properties": {**base["properties"], "popup": '<div data-codigo="1" class="infoMedusa">Playa libre de medusas</div>'}}
        pending = {**base, "properties": {**base["properties"], "popup": '<div data-codigo="2" class="infoMedusa">Validando...</div>'}}
        self.assertEqual(parse_feature(no_sighting).reportType, "no_sighting")  # type: ignore[union-attr]
        self.assertEqual(parse_feature(pending).reportType, "pending")  # type: ignore[union-attr]

    def test_abundance_ranges(self) -> None:
        self.assertEqual(abundance_severity("1"), 1.0)
        self.assertEqual(abundance_severity("2-5"), 1.25)
        self.assertEqual(abundance_severity("6-10"), 1.5)
        self.assertEqual(abundance_severity("11-99"), 2.0)
        self.assertEqual(abundance_severity("100-1000"), 3.0)

    def test_real_stat_labels(self) -> None:
        feature = {
            "geometry": {"coordinates": [-4.2, 36.7]},
            "properties": {
                "fecha": "2026-08-25 10:00:00",
                "popup": '<div data-codigo="8"><div class="infoMedusa" data-idmedusa="4">ⓘ Carybdea marsupialis</div><div class="card-stats"><div class="stat"><div class="type">cm.</div><div class="value">5-10</div></div><div class="stat"><div class="type"># Num.</div><div class="value">6-10</div></div></div></div>',
            },
        }
        parsed = parse_feature(feature)
        assert parsed is not None
        self.assertEqual(parsed.species, "Carybdea marsupialis")
        self.assertEqual(parsed.sizeRange, "5-10")
        self.assertEqual(parsed.abundanceRange, "6-10")
        self.assertEqual(parsed.abundanceSeverity, 1.5)


if __name__ == "__main__":
    unittest.main()
