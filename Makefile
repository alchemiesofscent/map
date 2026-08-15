check:
	python3 scripts/check_data.py
	python3 scripts/check_generated_tour.py
	python3 scripts/check_mendes_claims.py

mendes-court:
	python3 scripts/build_mendes_court_claims.py
	python3 scripts/check_mendes_claims.py

ingest:
	python3 scripts/ingest_tour_chunk.py --start 1 --count 66
	python3 scripts/apply_place_review_decisions.py --max-section 66
	python3 scripts/build_route_views.py

geojson:
	python3 scripts/export_geojson.py

pleiades:
	python3 scripts/refresh_pleiades.py

mymaps:
	python3 scripts/import_mymaps_kml.py

serve:
	python3 -m http.server 8000

serve-scrolly:
	python3 -m http.server 8000

.PHONY: check ingest geojson pleiades mymaps serve serve-scrolly
