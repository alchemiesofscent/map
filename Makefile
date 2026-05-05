check:
	python3 scripts/check_data.py
	python3 scripts/check_generated_tour.py

ingest:
	python3 scripts/ingest_tour_chunk.py --start 1 --count 10

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
