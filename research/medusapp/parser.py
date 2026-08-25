from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Any


VOID_ELEMENTS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


def normalize_text(value: str | None) -> str:
    text = unicodedata.normalize("NFKD", value or "")
    return " ".join("".join(char for char in text if not unicodedata.combining(char)).lower().split())


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    children: list["Node"]
    text_parts: list[str]

    def text(self) -> str:
        values = [*self.text_parts]
        for child in self.children:
            values.append(child.text())
        return " ".join(" ".join(values).split())

    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def find_all(self, *, tag: str | None = None, class_name: str | None = None) -> list["Node"]:
        matches = []
        if (tag is None or self.tag == tag) and (class_name is None or class_name in self.classes()):
            matches.append(self)
        for child in self.children:
            matches.extend(child.find_all(tag=tag, class_name=class_name))
        return matches


class TreeParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("root", {}, [], [])
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag, {key: value or "" for key, value in attrs}, [], [])
        self.stack[-1].children.append(node)
        if tag not in VOID_ELEMENTS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.stack[-1].text_parts.append(value)


@dataclass
class NormalizedReport:
    id: str
    latitude: float
    longitude: float
    timestamp: str | None
    beachName: str | None
    species: str | None
    abundanceRange: str | None
    abundanceSeverity: float
    sizeRange: str | None
    validationStatus: str
    reportStatus: str
    reportType: str
    typeEvidence: str
    source: str = "MedusApp"
    sourceType: str = "crowdsourced"
    origin: str = "observed"


def find_data_attribute(root: Node, name: str) -> str | None:
    for node in root.find_all():
        if node.attrs.get(name):
            return node.attrs[name]
    return None


def detail_value(root: Node, icon_fragment: str) -> str | None:
    for paragraph in root.find_all(tag="p"):
        icon_classes = " ".join(
            " ".join(icon.classes()) for icon in paragraph.find_all(tag="i")
        )
        if icon_fragment in icon_classes:
            value = paragraph.text().strip()
            return value or None
    return None


def stat_values(root: Node) -> dict[str, str]:
    result: dict[str, str] = {}
    for stat in root.find_all(class_name="stat"):
        labels = [node.text() for node in stat.find_all(class_name="type")]
        values = [node.text() for node in stat.find_all(class_name="value")]
        if labels and values:
            result[normalize_text(labels[0])] = values[0].strip()
    return result


def abundance_severity(value: str | None) -> float:
    if not value:
        return 1.0
    normalized = normalize_text(value)
    numbers = [int(item) for item in re.findall(r"\d+", normalized)]
    upper = max(numbers) if numbers else 1
    if upper <= 1:
        return 1.0
    if upper <= 5:
        return 1.25
    if upper <= 10:
        return 1.5
    if upper <= 99:
        return 2.0
    if upper <= 1000:
        return 3.0
    return 4.0


def parse_timestamp(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").isoformat()
    except ValueError:
        return None


def parse_feature(feature: dict[str, Any]) -> NormalizedReport | None:
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if len(coordinates) < 2:
        return None
    try:
        longitude, latitude = float(coordinates[0]), float(coordinates[1])
    except (TypeError, ValueError):
        return None

    properties = feature.get("properties") or {}
    popup = properties.get("popup") if isinstance(properties.get("popup"), str) else ""
    parser = TreeParser()
    parser.feed(popup)
    root = parser.root

    info_nodes = root.find_all(class_name="infoMedusa")
    species = info_nodes[0].text().strip() if info_nodes else None
    if species:
        species = re.sub(r"^[^\w]+", "", species, flags=re.UNICODE).strip()
    species = species or None
    beach_name = detail_value(root, "zmdi-pin-drop")
    stats = stat_values(root)
    abundance = next(
        (value for label, value in stats.items() if any(word in label for word in ("cantidad", "abundancia", "ejemplares", "# num", "numero"))),
        None,
    )
    size = next((value for label, value in stats.items() if any(word in label for word in ("tamano", "talla", "size", "cm"))), None)

    popup_normalized = normalize_text(root.text())
    data_id = find_data_attribute(root, "data-idmedusa")
    report_id = find_data_attribute(root, "data-codigo") or str(properties.get("nomfich") or "")
    if not report_id:
        digest = hashlib.sha256(f"{latitude}|{longitude}|{properties.get('fecha')}".encode()).hexdigest()
        report_id = digest[:16]

    pending = "validando" in popup_normalized or "pendiente de validacion" in popup_normalized
    no_sighting = any(
        phrase in popup_normalized
        for phrase in ("playa libre de medusas", "sin medusas", "no avistamiento", "ausencia de medusas")
    )
    classes = " ".join(
        " ".join(node.classes()) for node in root.find_all()
    ).lower()
    certified = any(marker in classes for marker in ("verified", "certified", "check-circle", "seal-check")) or any(
        phrase in popup_normalized for phrase in ("avistamiento certificado", "observacion certificada")
    )

    non_jellyfish = any(
        term in normalize_text(species)
        for term in (
            "mancha de aceite", "manchas de aceite", "espuma", "plastico", "basura",
            "residuo", "tronco", "madera", "otros objetos", "ctenoforo", "salpa",
        )
    )

    if pending:
        report_type = "pending"
        report_status = "pending"
        type_evidence = "popup:pending_phrase"
    elif no_sighting:
        report_type = "no_sighting"
        report_status = "published"
        type_evidence = "popup:no_sighting_phrase"
    elif non_jellyfish:
        report_type = "unknown"
        report_status = "published"
        type_evidence = "popup:non_jellyfish_taxon_or_object"
    elif data_id and species:
        report_type = "sighting"
        report_status = "published"
        type_evidence = "structured:data-idmedusa+species"
    else:
        report_type = "unknown"
        report_status = "unknown"
        type_evidence = "insufficient_structured_evidence"
    validation = "certified" if certified else "pending" if pending else "not_certified"

    return NormalizedReport(
        id=report_id,
        latitude=latitude,
        longitude=longitude,
        timestamp=parse_timestamp(properties.get("fecha")),
        beachName=beach_name,
        species=None if no_sighting or pending else species,
        abundanceRange=abundance,
        abundanceSeverity=abundance_severity(abundance),
        sizeRange=size,
        validationStatus=validation,
        reportStatus=report_status,
        reportType=report_type,
        typeEvidence=type_evidence,
    )


def parse_feature_collection(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("MedusApp response is not a GeoJSON FeatureCollection")
    reports = []
    for feature in payload.get("features") or []:
        if isinstance(feature, dict):
            parsed = parse_feature(feature)
            if parsed:
                reports.append(asdict(parsed))
    return reports
