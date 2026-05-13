.PHONY: install-hooks smoke-test

## Wire up the committed git hooks (run once after cloning)
install-hooks:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-push
	@echo "Git hooks installed."

## Run smoke tests against the dev backend manually
smoke-test:
	bash .githooks/pre-push
