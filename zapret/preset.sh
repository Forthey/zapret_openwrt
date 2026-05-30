#!/bin/sh
# Copyright (c) 2026
#
# Manage user strategy presets stored as JSON files in $ZAPRET_BASE/presets.
# CRUD of the JSON files is done by the LuCI app directly (via the file RPC).
# This script only performs the privileged "activate" operation: copy a preset
# into the main UCI section, regenerate the main config and restart the service.

EXE_DIR=$(cd "$(dirname "$0")" 2>/dev/null || exit 1; pwd)

[ -f "$EXE_DIR/comfunc.sh" ] || { echo "ERROR: file $EXE_DIR/comfunc.sh not found!"; exit 1; }
. $EXE_DIR/comfunc.sh

PRESETS_DIR="$ZAPRET_BASE/presets"
ACTIVE_FILE="$PRESETS_DIR/.active"

json_get_field()
{
	local file=$1
	local field=$2
	jsonfilter -i "$file" -e "@.$field" 2>/dev/null
}

cmd_list()
{
	[ -d "$PRESETS_DIR" ] || return 0
	for f in "$PRESETS_DIR"/*.json; do
		[ -f "$f" ] || continue
		local b="${f##*/}"
		echo "${b%.json}"
	done
}

cmd_current()
{
	[ -f "$ACTIVE_FILE" ] && cat "$ACTIVE_FILE"
	return 0
}

cmd_activate()
{
	local id="$1"
	[ -n "$id" ] || { echo "ERROR: preset id not specified"; return 4; }
	local file="$PRESETS_DIR/$id.json"
	[ -f "$file" ] || { echo "ERROR: preset not found: $id"; return 71; }

	if ! command -v jsonfilter >/dev/null 2>&1; then
		echo "ERROR: jsonfilter not found"; return 72
	fi

	local nfqws_opt ports_tcp ports_udp
	nfqws_opt=$( json_get_field "$file" nfqws_opt )
	ports_tcp=$( json_get_field "$file" ports_tcp )
	ports_udp=$( json_get_field "$file" ports_udp )

	[ -n "$nfqws_opt" ] || { echo "ERROR: preset '$id' has empty nfqws_opt"; return 73; }

	uci set $ZAPRET_CFG_SEC.NFQWS_OPT="$nfqws_opt"
	[ -n "$ports_tcp" ] && uci set $ZAPRET_CFG_SEC.NFQWS_PORTS_TCP="$ports_tcp"
	[ -n "$ports_udp" ] && uci set $ZAPRET_CFG_SEC.NFQWS_PORTS_UDP="$ports_udp"
	uci commit $ZAPRET_CFG_NAME

	# regenerate /opt/zapret/config from uci
	$ZAPRET_BASE/sync_config.sh
	if [ ! -s "$ZAPRET_CONFIG" ] || ! is_valid_config "$ZAPRET_CONFIG" ; then
		echo "ERROR: failed to generate valid main config"; return 74
	fi

	mkdir -p "$PRESETS_DIR"
	echo "$id" > "$ACTIVE_FILE"

	$ZAPRET_INITD restart
	echo "RESULT: (+) Preset '$id' activated"
	return 0
}

case "$1" in
	activate) cmd_activate "$2";;
	current)  cmd_current;;
	list)     cmd_list;;
	*) echo "Usage: ${0##*/} {activate <id>|current|list}"; exit 4;;
esac
