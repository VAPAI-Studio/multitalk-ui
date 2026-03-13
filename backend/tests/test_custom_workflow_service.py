"""
Unit tests for CustomWorkflowService parser functions.

Tests format detection, link filtering, node parsing, and workflow
parse orchestration. Does NOT require a running Supabase or ComfyUI instance.
"""
import pytest


# ============================================================================
# Sample workflow data fixtures
# ============================================================================

@pytest.fixture
def api_format_workflow():
    """A realistic ComfyUI API-format workflow (based on img2img.json pattern)."""
    return {
        "3": {
            "inputs": {
                "seed": 280823642470253,
                "steps": 20,
                "cfg": 7.5,
                "sampler_name": "euler",
                "model": ["14", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0]
            },
            "class_type": "KSampler",
            "_meta": {"title": "KSampler"}
        },
        "6": {
            "inputs": {
                "text": "a beautiful landscape",
                "clip": ["14", 1]
            },
            "class_type": "CLIPTextEncode",
            "_meta": {"title": "Positive Prompt"}
        },
        "8": {
            "inputs": {
                "samples": ["3", 0],
                "vae": ["14", 2]
            },
            "class_type": "VAEDecode",
            "_meta": {"title": "VAE Decode"}
        },
        "9": {
            "inputs": {
                "filename_prefix": "output",
                "images": ["8", 0]
            },
            "class_type": "SaveImage"
        }
    }


@pytest.fixture
def ui_format_workflow_nodes():
    """A ComfyUI UI-format workflow with 'nodes' array."""
    return {
        "nodes": [
            {"id": 1, "type": "KSampler", "inputs": []},
            {"id": 2, "type": "CLIPTextEncode", "inputs": []},
        ],
        "links": [
            [1, 0, 2, 0, "MODEL"]
        ],
        "groups": [],
        "config": {},
        "extra": {},
    }


@pytest.fixture
def ui_format_workflow_version():
    """A ComfyUI UI-format workflow with numeric 'version' key."""
    return {
        "version": 1,
        "nodes": [],
        "links": [],
    }


@pytest.fixture
def ui_format_workflow_links_only():
    """A partial UI-format workflow with 'links' array but no 'nodes'."""
    return {
        "links": [
            [1, 0, 2, 0, "MODEL"]
        ],
        "extra": {},
    }


# ============================================================================
# detect_workflow_format tests
# ============================================================================

class TestDetectWorkflowFormat:
    """Tests for CustomWorkflowService.detect_workflow_format."""

    def test_api_format_detected(self, api_format_workflow):
        """API format: dict with numeric string keys containing class_type."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format(api_format_workflow)
        assert result == "api"

    def test_ui_format_with_nodes_array(self, ui_format_workflow_nodes):
        """UI format: dict with top-level 'nodes' array."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format(ui_format_workflow_nodes)
        assert result == "ui"

    def test_ui_format_with_links_array(self, ui_format_workflow_links_only):
        """UI format: dict with top-level 'links' array."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format(ui_format_workflow_links_only)
        assert result == "ui"

    def test_ui_format_with_version_key(self, ui_format_workflow_version):
        """UI format: dict with numeric 'version' key."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format(ui_format_workflow_version)
        assert result == "ui"

    def test_unknown_format_empty_dict(self):
        """Unknown format: empty dict."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format({})
        assert result == "unknown"

    def test_unknown_format_unrecognized_structure(self):
        """Unknown format: dict with no recognizable pattern."""
        from services.custom_workflow_service import CustomWorkflowService
        result = CustomWorkflowService.detect_workflow_format({"foo": "bar", "baz": 42})
        assert result == "unknown"

    def test_skips_underscore_prefixed_keys(self):
        """API format detection skips keys starting with '_' (like _meta)."""
        from services.custom_workflow_service import CustomWorkflowService

        # Only has _meta key and no class_type nodes -> unknown
        data = {"_meta": {"title": "test"}}
        result = CustomWorkflowService.detect_workflow_format(data)
        assert result == "unknown"

    def test_api_format_with_meta_key(self):
        """API format still detected when _meta key is present alongside nodes."""
        from services.custom_workflow_service import CustomWorkflowService

        data = {
            "_meta": {"title": "test workflow"},
            "1": {
                "class_type": "KSampler",
                "inputs": {"seed": 42}
            }
        }
        result = CustomWorkflowService.detect_workflow_format(data)
        assert result == "api"


# ============================================================================
# is_link_input tests
# ============================================================================

class TestIsLinkInput:
    """Tests for CustomWorkflowService.is_link_input."""

    def test_link_array_detected(self):
        """[string, int] arrays like ['14', 0] are links."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(["14", 0]) is True

    def test_link_array_different_values(self):
        """Various valid link arrays."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(["3", 1]) is True
        assert CustomWorkflowService.is_link_input(["100", 2]) is True

    def test_string_value_not_link(self):
        """Regular string is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input("hello") is False

    def test_number_value_not_link(self):
        """Regular number is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(42) is False

    def test_boolean_value_not_link(self):
        """Boolean is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(True) is False

    def test_none_value_not_link(self):
        """None is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(None) is False

    def test_empty_list_not_link(self):
        """Empty list is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input([]) is False

    def test_three_element_list_not_link(self):
        """List with 3 elements is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(["14", 0, "extra"]) is False

    def test_wrong_types_in_list_not_link(self):
        """[int, int] is not a link (first must be str)."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input([14, 0]) is False

    def test_wrong_types_reversed_not_link(self):
        """[str, str] is not a link (second must be int)."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(["14", "0"]) is False

    def test_dict_value_not_link(self):
        """Dict is not a link."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input({"key": "value"}) is False

    def test_float_second_element_not_link(self):
        """[str, float] is not a link (second must be int, not float)."""
        from services.custom_workflow_service import CustomWorkflowService
        assert CustomWorkflowService.is_link_input(["14", 0.5]) is False


# ============================================================================
# parse_workflow_nodes tests
# ============================================================================

class TestParseWorkflowNodes:
    """Tests for CustomWorkflowService.parse_workflow_nodes."""

    def test_extracts_node_id_and_class_type(self, api_format_workflow):
        """Parser extracts node_id and class_type from each node."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        node_ids = {n.node_id for n in nodes}
        assert "3" in node_ids
        assert "6" in node_ids
        assert "8" in node_ids
        assert "9" in node_ids

        ksampler = next(n for n in nodes if n.node_id == "3")
        assert ksampler.class_type == "KSampler"

    def test_extracts_title_from_meta(self, api_format_workflow):
        """Parser extracts title from _meta.title when present."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        ksampler = next(n for n in nodes if n.node_id == "3")
        assert ksampler.title == "KSampler"

        prompt = next(n for n in nodes if n.node_id == "6")
        assert prompt.title == "Positive Prompt"

    def test_missing_meta_title_is_none(self, api_format_workflow):
        """When _meta or _meta.title is missing, title is None."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        save_image = next(n for n in nodes if n.node_id == "9")
        assert save_image.title is None

    def test_all_inputs_extracted(self, api_format_workflow):
        """Parser extracts all inputs for each node."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        ksampler = next(n for n in nodes if n.node_id == "3")
        input_names = {i.name for i in ksampler.inputs}
        assert "seed" in input_names
        assert "steps" in input_names
        assert "cfg" in input_names
        assert "sampler_name" in input_names
        assert "model" in input_names
        assert "positive" in input_names

    def test_link_inputs_marked(self, api_format_workflow):
        """Link inputs are marked with is_link=True."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        ksampler = next(n for n in nodes if n.node_id == "3")
        model_input = next(i for i in ksampler.inputs if i.name == "model")
        assert model_input.is_link is True

        positive_input = next(i for i in ksampler.inputs if i.name == "positive")
        assert positive_input.is_link is True

    def test_configurable_inputs_exclude_links(self, api_format_workflow):
        """configurable_inputs contains only non-link inputs."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        nodes = service.parse_workflow_nodes(api_format_workflow)

        ksampler = next(n for n in nodes if n.node_id == "3")
        config_names = {i.name for i in ksampler.configurable_inputs}

        # Configurable (not links)
        assert "seed" in config_names
        assert "steps" in config_names
        assert "cfg" in config_names
        assert "sampler_name" in config_names

        # Links (excluded)
        assert "model" not in config_names
        assert "positive" not in config_names
        assert "negative" not in config_names
        assert "latent_image" not in config_names

    def test_skips_underscore_prefixed_keys(self):
        """Parser skips top-level keys starting with '_'."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)

        data = {
            "_meta": {"title": "workflow"},
            "1": {
                "class_type": "Test",
                "inputs": {"value": 42}
            }
        }
        nodes = service.parse_workflow_nodes(data)
        assert len(nodes) == 1
        assert nodes[0].node_id == "1"


# ============================================================================
# parse_workflow tests (orchestrator)
# ============================================================================

class TestParseWorkflow:
    """Tests for CustomWorkflowService.parse_workflow (async orchestrator)."""

    @pytest.mark.asyncio
    async def test_api_format_success(self, api_format_workflow):
        """Valid API-format JSON returns success with parsed nodes."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        success, response, error = await service.parse_workflow(api_format_workflow)

        assert success is True
        assert response is not None
        assert response.success is True
        assert response.format == "api"
        assert len(response.nodes) == 4
        assert response.error is None

    @pytest.mark.asyncio
    async def test_ui_format_rejected(self, ui_format_workflow_nodes):
        """UI-format JSON is rejected with clear error message."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        success, response, error = await service.parse_workflow(ui_format_workflow_nodes)

        assert success is False
        assert response is not None
        assert response.success is False
        assert response.format == "ui"
        assert "Dev Mode" in response.error
        assert "Save (API Format)" in response.error

    @pytest.mark.asyncio
    async def test_unknown_format_rejected(self):
        """Unknown format JSON is rejected with error."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        success, response, error = await service.parse_workflow({"foo": "bar"})

        assert success is False
        assert response is not None
        assert response.success is False
        assert response.format == "unknown"
        assert response.error is not None

    @pytest.mark.asyncio
    async def test_empty_dict_rejected(self):
        """Empty dict is rejected as unknown format."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        success, response, error = await service.parse_workflow({})

        assert success is False
        assert response is not None
        assert response.success is False

    @pytest.mark.asyncio
    async def test_parsed_nodes_have_configurable_inputs(self, api_format_workflow):
        """Parsed nodes in the response have configurable_inputs populated."""
        from services.custom_workflow_service import CustomWorkflowService
        service = CustomWorkflowService.__new__(CustomWorkflowService)
        success, response, _ = await service.parse_workflow(api_format_workflow)

        ksampler = next(n for n in response.nodes if n.node_id == "3")
        assert len(ksampler.configurable_inputs) > 0
        # All configurable inputs should be non-links
        for inp in ksampler.configurable_inputs:
            assert inp.is_link is False
